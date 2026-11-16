import safeAssign from '@helpers/object/safeAssign';
import SDP from '@lib/calls/sdp';
import SDPMediaSection from '@lib/calls/sdp/mediaSection';
import LocalConferenceDescription from '@lib/calls/localConferenceDescription';
import {AudioCodec, PayloadType, RtpHdrexts, VideoCodec} from '@lib/calls/types';

/**
 * The SFU's answer may omit a codec table our own offer still needs (an
 * answer without `audio`, or the presentation upgrade's by-design
 * `Omit<..., 'audio'>` shape) while the local connection keeps the matching
 * m-line. SDPBuilder.addSsrcEntry reads the table per emitted entry and
 * throws on `undefined`. Deriving the table from the section of the offer we
 * just applied is also the only correct source: setRemoteDescription accepts
 * back exactly the payload types Chrome itself offered.
 */
function buildCodecFromSection(section: SDPMediaSection): AudioCodec | VideoCodec | undefined {
  const {attributes, mediaLineParts} = section;
  const rtpmap = attributes.get('rtpmap');
  const payloadTypes: PayloadType[] = [];

  // Only payload types the m-line offers may go back into the answer.
  for(const id of mediaLineParts.ids) {
    const value = rtpmap.get(id).value;
    if(!value) {
      continue;
    }

    const [name, clockrate, channels] = value.split('/');
    const payloadType: PayloadType = {
      id: +id,
      name,
      clockrate: +clockrate
    };

    if(channels !== undefined) {
      payloadType.channels = +channels;
    }

    const fmtp = attributes.get('fmtp').get(id).value;
    if(fmtp) {
      const parameters: {[key: string]: string} = {};
      for(const pair of fmtp.split(';')) {
        const idx = pair.indexOf('=');
        if(idx !== -1) {
          parameters[pair.slice(0, idx)] = pair.slice(idx + 1);
        }
      }

      if(Object.keys(parameters).length) {
        payloadType.parameters = parameters;
      }
    }

    const fbs = attributes.get('rtcp-fb').get(id).lines;
    if(fbs.length) {
      payloadType['rtcp-fbs'] = fbs.map((line) => {
        const [type, subtype] = line.split(' ');
        return subtype !== undefined ? {type, subtype} : {type};
      });
    }

    payloadTypes.push(payloadType);
  }

  if(!payloadTypes.length) {
    return undefined;
  }

  const rtpHdrexts: RtpHdrexts[] = [];
  attributes.get('extmap').forEach((extmap) => {
    // The key may carry a direction suffix (`1/recvonly`) — same split as
    // filterServerCodecs.
    const id = +(extmap.key.split('/', 1)[0]);
    if(extmap.value && !Number.isNaN(id)) {
      rtpHdrexts.push({id, uri: extmap.value});
    }
  });

  // `endpoint` / `server_sources` are answer fields nothing interpolates
  // into the SDP; the table is only ever read for the two keys below
  // (addSsrcEntry, fixLocalOffer, filterServerCodecs).
  return {'payload-types': payloadTypes, 'rtp-hdrexts': rtpHdrexts} as AudioCodec | VideoCodec;
}

export default function backfillMissingCodecs(description: LocalConferenceDescription, localSdp: SDP) {
  for(const section of localSdp.media) {
    if(section.mediaType === 'application') {
      continue;
    }

    // The same mid-to-section mapping the answer's entries come from
    // (negotiateInternal), so every entry below has its matching section.
    const entry = description.getEntryByMid(section.mid);
    if(!entry || entry.type === 'application' || description[entry.type]) {
      continue;
    }

    const codec = buildCodecFromSection(section);
    if(codec) {
      safeAssign(description, {[entry.type]: codec});
    }
  }
}
