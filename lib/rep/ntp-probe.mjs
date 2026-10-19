import { createSocket } from 'node:dgram';
const NTP_UNIX_SECONDS = 2208988800;
function putTimestamp(packet, offset, milliseconds) {
  const seconds = milliseconds / 1000 + NTP_UNIX_SECONDS;
  packet.writeUInt32BE(Math.floor(seconds) >>> 0, offset);
  packet.writeUInt32BE(
    Math.floor((seconds - Math.floor(seconds)) * 2 ** 32) >>> 0,
    offset + 4,
  );
}
function timestamp(packet, offset) {
  return (
    (packet.readUInt32BE(offset) -
      NTP_UNIX_SECONDS +
      packet.readUInt32BE(offset + 4) / 2 ** 32) *
    1000
  );
}
export function ntpRequest(at = Date.now()) {
  const packet = Buffer.alloc(48);
  packet[0] = 0x23;
  putTimestamp(packet, 40, at);
  return packet;
}
export function parseNtpResponse(packet, request, sentAt, receivedAt) {
  if (
    packet.length < 48 ||
    (packet[0] & 7) !== 4 ||
    packet[0] >>> 6 === 3 ||
    packet[1] < 1 ||
    packet[1] > 15 ||
    !packet.subarray(24, 32).equals(request.subarray(40, 48))
  )
    throw Error('Invalid NTP response');
  const receive = timestamp(packet, 32),
    transmit = timestamp(packet, 40),
    delay = receivedAt - sentAt - (transmit - receive);
  if (
    transmit < receive ||
    delay < -2 ||
    delay > 1000 ||
    packet.readUInt32BE(8) / 65536 > 1
  )
    throw Error('Unreliable NTP sample');
  const offsetMs = Math.round((receive - sentAt + (transmit - receivedAt)) / 2);
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 86400000)
    throw Error('NTP offset outside monitoring range');
  return { offsetMs, observedAt: new Date(receivedAt).toISOString() };
}
/** Observation only: chrony/ntpd remains responsible for keeping the host synchronized. */
export async function probeNtp(server = 'a.ntp.br') {
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(server)) throw Error('Invalid NTP host');
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      error ? reject(error) : resolve({ ...value, source: server });
    };
    const timeout = setTimeout(
      () => finish(Error('NTP observation timeout')),
      4000,
    );
    socket.once('error', (error) => finish(error));
    socket.connect(123, server, () => {
      const sentAt = Date.now(),
        request = ntpRequest(sentAt);
      socket.once('message', (packet) => {
        try {
          finish(null, parseNtpResponse(packet, request, sentAt, Date.now()));
        } catch (error) {
          finish(error);
        }
      });
      socket.send(request, (error) => {
        if (error) finish(error);
      });
    });
  });
}
