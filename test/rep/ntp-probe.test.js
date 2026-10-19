import test from 'node:test';
import assert from 'node:assert/strict';
import { ntpRequest, parseNtpResponse } from '../../lib/rep/ntp-probe.mjs';
function sample() {
  const sentAt = Date.parse('2026-10-18T12:00:00Z'),
    request = ntpRequest(sentAt),
    packet = Buffer.alloc(48);
  packet[0] = 0x24;
  packet[1] = 2;
  request.copy(packet, 24, 40, 48);
  ntpRequest(sentAt + 120).copy(packet, 32, 40, 48);
  ntpRequest(sentAt + 120).copy(packet, 40, 40, 48);
  return { sentAt, request, packet };
}
test('NTP offset subtracts round trip and binds the response to this request', () => {
  const { sentAt, request, packet } = sample();
  const result = parseNtpResponse(packet, request, sentAt, sentAt + 40);
  assert.equal(result.offsetMs, 100);
  assert.equal(result.observedAt, '2026-10-18T12:00:00.040Z');
  packet[24] ^= 1;
  assert.throws(() => parseNtpResponse(packet, request, sentAt, sentAt + 40));
});
test('unsynchronized, truncated and high-delay NTP responses never become success measurements', () => {
  const { sentAt, request, packet } = sample();
  assert.throws(() =>
    parseNtpResponse(packet.subarray(0, 40), request, sentAt, sentAt + 40),
  );
  packet[0] = 0xe4;
  assert.throws(() => parseNtpResponse(packet, request, sentAt, sentAt + 40));
  packet[0] = 0x24;
  assert.throws(() => parseNtpResponse(packet, request, sentAt, sentAt + 2000));
});
