/*
 * A group call's camera video travels on ssrcs the server only learns from the
 * join payload: it archives the payload's ssrc-groups and a later
 * video_stopped=false edit just flips the active bit. tgcalls clients always
 * pre-allocate the video ssrcs (tdesktop creates the main instance with
 * VideoContentType::Generic even with the camera off); tweb joins with a
 * trackless video transceiver, so alignOutgoingVideoSsrcs munges the missing
 * ssrcs in — tgcalls-style, derived from the audio ssrc — and re-seeds a live
 * camera that ended up off the archived ssrcs.
 */
import {describe, expect, it} from 'vitest';
import {addSimulcast, alignOutgoingVideoSsrcs, parseSdp} from '@lib/calls/sdp/utils';

const AUDIO_SSRC = 3333;

const JOIN_OFFER_CAMERA_OFF = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendonly',
  'a=rtpmap:111 opus/48000/2',
  `a=ssrc:${AUDIO_SSRC} cname:me`,
  `a=ssrc:${AUDIO_SSRC} msid:stream track`,
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=sendonly',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  ''
].join('\r\n');

const videoSection = (sdpString: string) => {
  return parseSdp(sdpString).media.find((section) => section.mediaType === 'video');
};

const videoGroups = (section: ReturnType<typeof videoSection>) => {
  return section.attributes.get('ssrc-group');
};

const archivedGroups = (ssrcs: number[][]) => {
  return ssrcs.map(([first, second]) => ({
    _: 'groupCallParticipantVideoSourceGroup' as const,
    semantics: 'FID',
    sources: [first, second]
  }));
};

describe('alignOutgoingVideoSsrcs', () => {
  it('allocates the whole tgcalls layer table for a trackless video m-line', () => {
    const sdp = parseSdp(JOIN_OFFER_CAMERA_OFF);
    expect(alignOutgoingVideoSsrcs(sdp)).toBe(true);

    const section = videoSection(sdp.toString());
    const groups = videoGroups(section);
    // tgcalls: outgoingVideoSsrcBase = audioSsrc + 1, layer i = base + i*2,
    // its RTX at +1.
    expect(groups.get('SIM').value).toBe(`${AUDIO_SSRC + 1} ${AUDIO_SSRC + 3} ${AUDIO_SSRC + 5}`);
    expect(groups.get('FID').lines).toEqual([
      `${AUDIO_SSRC + 1} ${AUDIO_SSRC + 2}`,
      `${AUDIO_SSRC + 3} ${AUDIO_SSRC + 4}`,
      `${AUDIO_SSRC + 5} ${AUDIO_SSRC + 6}`
    ]);

    // The declared ssrcs carry the audio ssrc's cname/msid attributes.
    const ssrc = section.attributes.get('ssrc');
    expect(ssrc.get('' + (AUDIO_SSRC + 1)).lines).toEqual(['cname:me', 'msid:stream track']);
    expect(ssrc.get('' + (AUDIO_SSRC + 6)).lines).toEqual(['cname:me', 'msid:stream track']);
  });

  it('is deterministic: re-allocating the same trackless offer reproduces it, and addSimulcast skips it', () => {
    const sdp = parseSdp(JOIN_OFFER_CAMERA_OFF);
    alignOutgoingVideoSsrcs(sdp);
    expect(addSimulcast(sdp, 3)).toBe(false);

    const once = sdp.toString();
    const second = parseSdp(JOIN_OFFER_CAMERA_OFF);
    alignOutgoingVideoSsrcs(second);
    expect(second.toString()).toBe(once);
  });

  it('allocates a single FID pair (no SIM) in a conference', () => {
    const sdp = parseSdp(JOIN_OFFER_CAMERA_OFF);
    expect(alignOutgoingVideoSsrcs(sdp, undefined, 1)).toBe(true);

    const groups = videoGroups(videoSection(sdp.toString()));
    expect(groups.get('SIM').exists).toBe(false);
    expect(groups.get('FID').value).toBe(`${AUDIO_SSRC + 1} ${AUDIO_SSRC + 2}`);
  });

  it('rewrites a live camera that ended up off the archived ssrcs', () => {
    const archived = {source: (AUDIO_SSRC + 1) << 0, sourceGroups: archivedGroups([[AUDIO_SSRC + 1, AUDIO_SSRC + 2]])};

    // Chrome ignored the munged declaration and allocated its own pair.
    const renegotiated = JOIN_OFFER_CAMERA_OFF.replace(
      'a=mid:1',
      ['a=mid:1', 'a=ssrc-group:FID 9999 8888', 'a=ssrc:9999 cname:me', 'a=ssrc:8888 cname:me'].join('\r\n')
    );
    const sdp = parseSdp(renegotiated);
    expect(alignOutgoingVideoSsrcs(sdp, archived)).toBe(true);

    const section = videoSection(sdp.toString());
    expect(section.attributes.get('ssrc').keys).toEqual(['' + (AUDIO_SSRC + 1), '' + (AUDIO_SSRC + 2)]);
    expect(videoGroups(section).get('FID').value).toBe(`${AUDIO_SSRC + 1} ${AUDIO_SSRC + 2}`);
    expect(section.attributes.get('ssrc').get('9999').exists).toBe(false);
  });

  it('leaves a live camera that matches the archive untouched', () => {
    const archived = {source: 1111 << 0, sourceGroups: archivedGroups([[1111, 2222]])};
    const offer = JOIN_OFFER_CAMERA_OFF.replace(
      'a=mid:1',
      ['a=mid:1', 'a=ssrc-group:FID 1111 2222', 'a=ssrc:1111 cname:me', 'a=ssrc:2222 cname:me'].join('\r\n')
    );

    const sdp = parseSdp(offer);
    expect(alignOutgoingVideoSsrcs(sdp, archived)).toBe(false);
    expect(sdp.toString()).toBe(offer);
  });

  it('leaves an offer without a sending video m-line untouched', () => {
    const audioOnly = JOIN_OFFER_CAMERA_OFF.split('m=video')[0];
    const sdp = parseSdp(audioOnly);
    expect(alignOutgoingVideoSsrcs(sdp)).toBe(false);
    expect(sdp.toString()).toBe(audioOnly);
  });
});
