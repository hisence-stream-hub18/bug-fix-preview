package app.lovable.universalmediaserver;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native SSDP discovery + UPnP AVTransport / RenderingControl control for the
 * Android build. The web layer talks to it through Capacitor.Plugins.UmsNative,
 * so the mobile app really pushes media to the TV instead of only previewing.
 *
 * Hisense (and other Samsung-derived DMRs) need sec:CaptionInfo(+Ex) inside the
 * DIDL-Lite metadata to render an external subtitle, so the same metadata
 * builder used by the desktop app is mirrored here.
 */
@CapacitorPlugin(name = "UmsNative")
public class UmsNativePlugin extends Plugin {

    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int CAST_MDNS_PORT = 5353;

    private final ExecutorService pool = Executors.newCachedThreadPool();

    // ------------------------------------------------------------ discovery

    /** Hands a link to the VLC player installed on the phone. */
    @PluginMethod
    public void openInVlc(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "لینک خالی است");
            call.resolve(ret);
            return;
        }
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setPackage("org.videolan.vlc");
            intent.setDataAndTypeAndNormalize(Uri.parse(url), "video/*");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("ok", true);
        } catch (Exception e) {
            try {
                // VLC missing: let Android offer any other installed player.
                Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                fallback.setDataAndTypeAndNormalize(Uri.parse(url), "video/*");
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                ret.put("ok", true);
            } catch (Exception e2) {
                ret.put("ok", false);
                ret.put("error", "VLC روی این گوشی نصب نیست");
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void scanDevices(PluginCall call) {
        final int timeout = clamp(call.getInt("timeout", 4000), 1500, 10000);
        pool.execute(() -> {
            try {
                List<JSObject> found = new ArrayList<>();
                found.addAll(ssdpSearch(timeout));
                found.addAll(castSearch(timeout));
                JSArray arr = new JSArray();
                for (JSObject o : found) arr.put(o);
                JSObject ret = new JSObject();
                ret.put("devices", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(message(e), e);
            }
        });
    }

    /** M-SEARCH for AVTransport renderers, then fetch each device description. */
    private List<JSObject> ssdpSearch(int timeout) {
        Map<String, JSObject> byId = new HashMap<>();
        Set<String> locations = new HashSet<>();
        String[] targets = {
            "urn:schemas-upnp-org:service:AVTransport:1",
            "urn:schemas-upnp-org:device:MediaRenderer:1",
        };

        MulticastSocket socket = null;
        try {
            socket = new MulticastSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(600);
            socket.setTimeToLive(4);
            InetAddress group = InetAddress.getByName(SSDP_ADDRESS);

            for (String st : targets) {
                String probe =
                    "M-SEARCH * HTTP/1.1\r\n"
                        + "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n"
                        + "MAN: \"ssdp:discover\"\r\n"
                        + "MX: 2\r\n"
                        + "ST: " + st + "\r\n\r\n";
                byte[] data = probe.getBytes(StandardCharsets.UTF_8);
                for (int i = 0; i < 2; i++) {
                    socket.send(new DatagramPacket(data, data.length, group, SSDP_PORT));
                }
            }

            long deadline = System.currentTimeMillis() + timeout;
            byte[] buf = new byte[8192];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buf, buf.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }
                String body = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                String location = header(body, "LOCATION");
                if (location == null || location.isEmpty() || !locations.add(location)) continue;
                JSObject device = describe(location);
                if (device != null) byId.put(device.getString("id", location), device);
            }
        } catch (Exception ignored) {
            // A missing multicast route just means "no DLNA device found".
        } finally {
            if (socket != null) socket.close();
        }
        return new ArrayList<>(byId.values());
    }

    /** Downloads the UPnP device description and extracts the control URLs. */
    private JSObject describe(String location) {
        String xml = httpGet(location);
        if (xml == null) return null;

        String name = tag(xml, "friendlyName");
        String model = tag(xml, "modelName");
        String manufacturer = tag(xml, "manufacturer");
        String udn = tag(xml, "UDN");
        String avControl = controlUrlFor(xml, "AVTransport");
        String rcControl = controlUrlFor(xml, "RenderingControl");
        if (avControl == null) return null;

        String base;
        try {
            URL url = new URL(location);
            base = url.getProtocol() + "://" + url.getHost() + (url.getPort() > 0 ? ":" + url.getPort() : "");
        } catch (Exception e) {
            return null;
        }

        JSObject device = new JSObject();
        device.put("id", (udn == null || udn.isEmpty()) ? location : udn);
        device.put("name", (name == null || name.isEmpty()) ? "دستگاه DLNA" : name);
        device.put("model", model == null ? "" : model);
        device.put("manufacturer", manufacturer == null ? "" : manufacturer);
        device.put("ip", hostOf(location));
        device.put("protocol", "DLNA");
        device.put("avTransportUrl", absolute(base, avControl));
        device.put("renderingControlUrl", rcControl == null ? "" : absolute(base, rcControl));
        device.put("location", location);
        return device;
    }

    /**
     * mDNS query for _googlecast._tcp.local so Chromecast / Android TV shows up
     * in the same list. Playback for those is handled by the desktop bridge or
     * the system Cast dialog; here we only surface them.
     */
    private List<JSObject> castSearch(int timeout) {
        List<JSObject> out = new ArrayList<>();
        MulticastSocket socket = null;
        try {
            socket = new MulticastSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(CAST_MDNS_PORT));
            socket.setSoTimeout(600);
            InetAddress group = InetAddress.getByName("224.0.0.251");
            joinAll(socket, group);

            byte[] query = mdnsQuery("_googlecast._tcp.local");
            socket.send(new DatagramPacket(query, query.length, group, CAST_MDNS_PORT));

            long deadline = System.currentTimeMillis() + Math.min(timeout, 4000);
            byte[] buf = new byte[9000];
            Set<String> seen = new HashSet<>();
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buf, buf.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }
                String raw = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.ISO_8859_1);
                if (!raw.contains("_googlecast")) continue;
                String ip = packet.getAddress().getHostAddress();
                if (ip == null || !seen.add(ip)) continue;
                String friendly = txtValue(raw, "fn=");
                JSObject device = new JSObject();
                device.put("id", "cast-" + ip);
                device.put("name", friendly != null ? friendly : "Chromecast " + ip);
                device.put("model", txtValue(raw, "md=") != null ? txtValue(raw, "md=") : "Chromecast");
                device.put("manufacturer", "Google Cast");
                device.put("ip", ip);
                device.put("port", 8009);
                device.put("protocol", "Cast");
                device.put("avTransportUrl", "");
                device.put("renderingControlUrl", "");
                device.put("location", "");
                out.add(device);
            }
        } catch (Exception ignored) {
            // no mDNS route / port busy -> no Cast devices
        } finally {
            if (socket != null) socket.close();
        }
        return out;
    }

    private void joinAll(MulticastSocket socket, InetAddress group) {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface nif : Collections.list(ifaces)) {
                if (!nif.supportsMulticast() || nif.isLoopback() || !nif.isUp()) continue;
                try {
                    socket.joinGroup(new InetSocketAddress(group, CAST_MDNS_PORT), nif);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    /** Minimal DNS PTR question packet. */
    private byte[] mdnsQuery(String name) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0);
        out.write(0); // id
        out.write(0);
        out.write(0); // flags: standard query
        out.write(0);
        out.write(1); // qdcount
        for (int i = 0; i < 6; i++) out.write(0); // an/ns/ar counts
        for (String label : name.split("\\.")) {
            byte[] bytes = label.getBytes(StandardCharsets.UTF_8);
            out.write(bytes.length);
            out.write(bytes, 0, bytes.length);
        }
        out.write(0);
        out.write(0);
        out.write(12); // QTYPE = PTR
        out.write(0);
        out.write(1); // QCLASS = IN
        return out.toByteArray();
    }

    private String txtValue(String raw, String prefix) {
        int idx = raw.indexOf(prefix);
        if (idx < 0) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = idx + prefix.length(); i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c < 0x20) break;
            sb.append(c);
        }
        String value = sb.toString().trim();
        return value.isEmpty() ? null : value;
    }

    // -------------------------------------------------------------- control

    @PluginMethod
    public void play(final PluginCall call) {
        final String controlUrl = call.getString("controlUrl", "");
        final String url = call.getString("url", "");
        final String title = call.getString("title", "Universal Media Server");
        final String mime = call.getString("mime", "video/mp4");
        final String subtitle = call.getString("subtitle", "");
        if (isBlank(controlUrl) || isBlank(url)) {
            call.reject("controlUrl و url الزامی هستند");
            return;
        }
        pool.execute(() -> {
            try {
                String metadata = didl(title, url, mime, subtitle);
                soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:AVTransport:1",
                    "SetAVTransportURI",
                    "<InstanceID>0</InstanceID>"
                        + "<CurrentURI>" + escape(url) + "</CurrentURI>"
                        + "<CurrentURIMetaData>" + escape(metadata) + "</CurrentURIMetaData>");
                soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:AVTransport:1",
                    "Play",
                    "<InstanceID>0</InstanceID><Speed>1</Speed>");
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("url", url);
                ret.put("subtitle", subtitle);
                call.resolve(ret);
            } catch (Exception e) {
                call.resolve(fail(message(e)));
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        simple(call, "Stop", "<InstanceID>0</InstanceID>");
    }

    @PluginMethod
    public void pause(PluginCall call) {
        simple(call, "Pause", "<InstanceID>0</InstanceID>");
    }

    @PluginMethod
    public void resume(PluginCall call) {
        simple(call, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
    }

    @PluginMethod
    public void seek(PluginCall call) {
        int seconds = Math.max(0, clamp(call.getInt("seconds", 0), 0, Integer.MAX_VALUE));
        simple(
            call,
            "Seek",
            "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>" + clock(seconds) + "</Target>");
    }

    @PluginMethod
    public void setVolume(final PluginCall call) {
        final String controlUrl = call.getString("controlUrl", "");
        final int volume = clamp(call.getInt("volume", 30), 0, 100);
        pool.execute(() -> {
            try {
                soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:RenderingControl:1",
                    "SetVolume",
                    "<InstanceID>0</InstanceID><Channel>Master</Channel>"
                        + "<DesiredVolume>" + volume + "</DesiredVolume>");
                call.resolve(ok());
            } catch (Exception e) {
                call.resolve(fail(message(e)));
            }
        });
    }

    @PluginMethod
    public void setMute(final PluginCall call) {
        final String controlUrl = call.getString("controlUrl", "");
        final boolean mute = Boolean.TRUE.equals(call.getBoolean("mute", false));
        pool.execute(() -> {
            try {
                soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:RenderingControl:1",
                    "SetMute",
                    "<InstanceID>0</InstanceID><Channel>Master</Channel>"
                        + "<DesiredMute>" + (mute ? 1 : 0) + "</DesiredMute>");
                call.resolve(ok());
            } catch (Exception e) {
                call.resolve(fail(message(e)));
            }
        });
    }

    /** TransportInfo + PositionInfo in one call, for the progress bar. */
    @PluginMethod
    public void deviceState(final PluginCall call) {
        final String controlUrl = call.getString("controlUrl", "");
        pool.execute(() -> {
            try {
                String info = soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:AVTransport:1",
                    "GetTransportInfo",
                    "<InstanceID>0</InstanceID>");
                String pos = soap(
                    controlUrl,
                    "urn:schemas-upnp-org:service:AVTransport:1",
                    "GetPositionInfo",
                    "<InstanceID>0</InstanceID>");
                JSObject position = new JSObject();
                position.put("relSeconds", seconds(tag(pos, "RelTime")));
                position.put("durationSeconds", seconds(tag(pos, "TrackDuration")));
                position.put("uri", orEmpty(tag(pos, "TrackURI")));
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("state", orEmpty(tag(info, "CurrentTransportState")));
                ret.put("position", position);
                call.resolve(ret);
            } catch (Exception e) {
                call.resolve(fail(message(e)));
            }
        });
    }

    private void simple(final PluginCall call, final String action, final String body) {
        final String controlUrl = call.getString("controlUrl", "");
        if (isBlank(controlUrl)) {
            call.resolve(fail("این دستگاه سرویس AVTransport ندارد"));
            return;
        }
        pool.execute(() -> {
            try {
                soap(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1", action, body);
                call.resolve(ok());
            } catch (Exception e) {
                call.resolve(fail(message(e)));
            }
        });
    }

    // ----------------------------------------------------------------- SOAP

    private String soap(String controlUrl, String service, String action, String body) throws Exception {
        String envelope =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
                + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body><u:" + action + " xmlns:u=\"" + service + "\">"
                + body
                + "</u:" + action + "></s:Body></s:Envelope>";

        HttpURLConnection conn = (HttpURLConnection) new URL(controlUrl).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(9000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        conn.setRequestProperty("SOAPAction", "\"" + service + "#" + action + "\"");
        conn.setRequestProperty("Connection", "close");
        byte[] payload = envelope.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(payload.length);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload);
        }
        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String response = read(stream);
        conn.disconnect();
        if (code >= 400) {
            String reason = tag(response, "errorDescription");
            throw new Exception("SOAP " + code + (reason == null ? "" : ": " + reason));
        }
        return response;
    }

    /** DIDL-Lite with the sec:/pv: subtitle hints Hisense, Samsung and LG need. */
    private String didl(String title, String url, String mime, String subtitle) {
        String upnpClass = mime.startsWith("audio")
            ? "object.item.audioItem.musicTrack"
            : mime.startsWith("image") ? "object.item.imageItem.photo" : "object.item.videoItem";
        String subXml = "";
        if (!isBlank(subtitle)) {
            String ext = subtitle.toLowerCase(Locale.US).contains(".vtt") ? "vtt" : "srt";
            String subMime = ext.equals("vtt") ? "text/vtt" : "application/x-subrip";
            subXml =
                "<sec:CaptionInfoEx sec:type=\"" + ext + "\">" + escape(subtitle) + "</sec:CaptionInfoEx>"
                    + "<sec:CaptionInfo sec:type=\"" + ext + "\">" + escape(subtitle) + "</sec:CaptionInfo>"
                    + "<pv:subtitleFileUri>" + escape(subtitle) + "</pv:subtitleFileUri>"
                    + "<pv:subtitleFileType>" + ext + "</pv:subtitleFileType>"
                    + "<res protocolInfo=\"http-get:*:" + subMime + ":*\">" + escape(subtitle) + "</res>";
        }
        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\""
            + " xmlns:dc=\"http://purl.org/dc/elements/1.1/\""
            + " xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\""
            + " xmlns:sec=\"http://www.sec.co.kr/\""
            + " xmlns:pv=\"http://www.pv.com/pvns/\">"
            + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
            + "<dc:title>" + escape(title) + "</dc:title>"
            + "<upnp:class>" + upnpClass + "</upnp:class>"
            + "<res protocolInfo=\"http-get:*:" + escape(mime)
            + ":DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\">"
            + escape(url) + "</res>"
            + subXml
            + "</item></DIDL-Lite>";
    }

    // ---------------------------------------------------------------- utils

    private String httpGet(String location) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(location).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Connection", "close");
            String body = read(conn.getInputStream());
            conn.disconnect();
            return body;
        } catch (Exception e) {
            return null;
        }
    }

    private String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private String header(String message, String name) {
        for (String line : message.split("\r?\n")) {
            int idx = line.indexOf(':');
            if (idx <= 0) continue;
            if (line.substring(0, idx).trim().equalsIgnoreCase(name)) {
                return line.substring(idx + 1).trim();
            }
        }
        return null;
    }

    private String tag(String xml, String name) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + name + "[^>]*>([\\s\\S]*?)</(?:\\w+:)?" + name + ">")
            .matcher(xml == null ? "" : xml);
        return m.find() ? unescape(m.group(1).trim()) : null;
    }

    private String controlUrlFor(String xml, String serviceName) {
        Matcher m = Pattern.compile("<service>([\\s\\S]*?)</service>").matcher(xml);
        while (m.find()) {
            String block = m.group(1);
            if (block.contains(serviceName)) {
                String control = tag(block, "controlURL");
                if (control != null && !control.isEmpty()) return control;
            }
        }
        return null;
    }

    private String absolute(String base, String relative) {
        if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
        return base + (relative.startsWith("/") ? relative : "/" + relative);
    }

    private String hostOf(String location) {
        try {
            return new URL(location).getHost();
        } catch (Exception e) {
            return "";
        }
    }

    private int seconds(String clock) {
        if (clock == null) return 0;
        String[] parts = clock.split(":");
        try {
            if (parts.length == 3) {
                return Integer.parseInt(parts[0].trim()) * 3600
                    + Integer.parseInt(parts[1].trim()) * 60
                    + (int) Double.parseDouble(parts[2].trim());
            }
            if (parts.length == 2) {
                return Integer.parseInt(parts[0].trim()) * 60 + (int) Double.parseDouble(parts[1].trim());
            }
            return (int) Double.parseDouble(clock.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private String clock(int total) {
        int h = total / 3600;
        int m = (total % 3600) / 60;
        int s = total % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, s);
    }

    private String escape(String value) {
        if (value == null) return "";
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }

    private String unescape(String value) {
        return value
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private String orEmpty(String value) {
        return value == null ? "" : value;
    }

    private int clamp(Integer value, int min, int max) {
        int v = value == null ? min : value;
        return Math.max(min, Math.min(max, v));
    }

    private JSObject ok() {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        return ret;
    }

    private JSObject fail(String error) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("error", error);
        return ret;
    }

    private String message(Exception e) {
        String msg = e.getMessage();
        return isBlank(msg) ? e.getClass().getSimpleName() : msg;
    }

    @SuppressWarnings("unused")
    private void unusedJsonGuard() throws JSONException {
        // keeps the org.json import meaningful for older Capacitor toolchains
        new JSObject().put("noop", true);
    }
}
