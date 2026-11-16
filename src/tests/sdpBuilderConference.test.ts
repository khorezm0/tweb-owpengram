/*
 * The SFU's join answer becomes the SDP of setRemoteDescription through
 * SDPBuilder.addConference. addHeader always announces BUNDLE, and Chrome
 * rejects a bundled description whose active m-lines lack rtcp-mux ("rtcp-mux
 * must be enabled when BUNDLE is enabled"). The SFU muxes RTP and RTCP
 * regardless, but its transport table may omit the flag — the builder emits
 * the attribute itself instead of copying the flag, like the P2P path does.
 */
import {describe, expect, it} from 'vitest';
import LocalConferenceDescription, {ConferenceEntry} from '@lib/calls/localConferenceDescription';
import {SDPBuilder} from '@lib/calls/sdpBuilder';
import {UpdateGroupCallConnectionData} from '@lib/calls/types';

const connectionData = (): UpdateGroupCallConnectionData => ({
  transport: {
    ufrag: 'abcd',
    pwd: 'secret',
    fingerprints: [{hash: 'sha-256', fingerprint: 'AA:BB', setup: 'passive'}]
  },
  audio: {
    'payload-types': [{id: 111, name: 'opus', clockrate: 48000, channels: 2}],
    'rtp-hdrexts': []
  },
  video: {
    endpoint: 'ep1',
    'payload-types': [{id: 96, name: 'VP8', clockrate: 90000}],
    'rtp-hdrexts': []
  }
});

function makeConference(data: UpdateGroupCallConnectionData) {
  const description = new LocalConferenceDescription(undefined as any);
  description.setData(data);
  return description;
}

function makeEntry(mid: string, type: 'audio' | 'video') {
  const entry = new ConferenceEntry(mid, type);
  entry.setDirection('sendonly');
  entry.setSource(1234);
  return entry;
}

describe('SDPBuilder.addConference answer', () => {
  it('emits rtcp-mux in every active m-line though the transport omits the flag', () => {
    const data = connectionData();
    delete (data.transport as any)['rtcp-mux'];
    const description = makeConference(data);
    const entries = [makeEntry('0', 'audio'), makeEntry('1', 'video')];

    const sdp = SDPBuilder.fromConference({
      conference: description,
      bundle: ['0', '1'],
      entries,
      isAnswer: true
    });

    const mediaSections = sdp.split('m=').slice(1);
    expect(mediaSections).toHaveLength(2);
    for(const section of mediaSections) {
      expect(section.trim().startsWith('audio') || section.trim().startsWith('video')).toBe(true);
      expect(section).toContain('a=rtcp-mux');
    }
  });
});
