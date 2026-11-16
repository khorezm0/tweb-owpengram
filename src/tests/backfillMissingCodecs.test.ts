import {describe, expect, it} from 'vitest';
import backfillMissingCodecs from '@lib/calls/helpers/backfillMissingCodecs';
import LocalConferenceDescription from '@lib/calls/localConferenceDescription';
import {parseSdp} from '@lib/calls/sdp/utils';
import {AudioCodec} from '@lib/calls/types';

const localOffer = [
  'v=0',
  'o=- 1234 2 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 9',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendonly',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:9 G722/8000/1',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtcp-fb:111 transport-cc',
  'a=rtcp-fb:111 nack',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=sendonly',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtcp-fb:96 nack pli',
  'a=extmap:2/recvonly urn:ietf:params:rtp-hdrext:toffset'
].join('\r\n');

describe('backfillMissingCodecs', () => {
  it('derives a missing audio table from the matching section of the local offer', () => {
    const description = new LocalConferenceDescription(undefined);
    description.createEntry('audio').setDirection('sendonly');

    backfillMissingCodecs(description, parseSdp(localOffer));

    expect(description.audio).toEqual({
      'payload-types': [
        {
          id: 111,
          name: 'opus',
          clockrate: 48000,
          channels: 2,
          parameters: {minptime: '10', useinbandfec: '1'},
          'rtcp-fbs': [{type: 'transport-cc'}, {type: 'nack'}]
        },
        {
          id: 9,
          name: 'G722',
          clockrate: 8000,
          channels: 1
        }
      ],
      'rtp-hdrexts': [{id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'}]
    });
  });

  it('derives a missing screencast table from a video section', () => {
    const description = new LocalConferenceDescription(undefined);
    description.createEntry('audio');
    description.createEntry('screencast').setDirection('sendonly');

    backfillMissingCodecs(description, parseSdp(localOffer));

    expect(description.screencast).toEqual({
      'payload-types': [
        {
          id: 96,
          name: 'VP8',
          clockrate: 90000,
          'rtcp-fbs': [{type: 'nack', subtype: 'pli'}]
        },
        {
          id: 97,
          name: 'rtx',
          clockrate: 90000,
          parameters: {apt: '96'}
        }
      ],
      'rtp-hdrexts': [{id: 2, uri: 'urn:ietf:params:rtp-hdrext:toffset'}]
    });
  });

  it('leaves a table the server sent alone and skips types with no entry', () => {
    const description = new LocalConferenceDescription(undefined);
    description.createEntry('audio');
    const audio: AudioCodec = {
      'payload-types': [{id: 111, name: 'opus', clockrate: 48000, channels: 2}],
      'rtp-hdrexts': []
    };
    description.setData({audio} as any);

    backfillMissingCodecs(description, parseSdp(localOffer));

    expect(description.audio).toBe(audio);
    expect(description.screencast).toBeUndefined();
  });
});
