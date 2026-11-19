import {GroupCallParticipantVideoSourceGroup} from '@layer';
import SDP from '.';
import splitStringByLimitWithRest from '@helpers/string/splitStringByLimitWithRest';
import UniqueNumberGenerator from '@helpers/uniqueNumberGenerator';
import {fromTelegramSource, toTelegramSource} from '@lib/calls/utils';
import SDPLine from '@lib/calls/sdp/line';
import SDPMediaSection from '@lib/calls/sdp/mediaSection';
import SDPSessionSection from '@lib/calls/sdp/sessionSection';

export function parseSdp(str: string) {
  function createSection() {
    if(sessionSection) {
      mediaSections.push(new SDPMediaSection(lines));
    } else {
      sessionSection = new SDPSessionSection(lines);
    }
  }

  let sessionSection: SDPSessionSection = null, lines: SDPLine[] = [];
  const mediaSections: SDPMediaSection[] = [];
  str.split(/\r?\n/).forEach((lineStr) => {
    if(!isIncorrectSdpLine(lineStr)) {
      const line = parseSdpLine(lineStr);
      if(line.key === 'm') {
        createSection();
        lines = [];
      }

      lines.push(line);
    }
  });

  createSection();
  return new SDP(sessionSection, mediaSections);
}

export function isIncorrectSdpLine(str: string) {
  return /^[\s\xa0]*$/.test(str);
}

export function parseSdpLine(str: string) {
  const splitted = splitStringByLimitWithRest(str, '=', 1);
  return new SDPLine(splitted[0] as any, splitted[1]);
}

/**
 * Legacy (SSRC-group) simulcast: Chromium creates one encoding per `SIM`
 * member when the munged offer is applied locally, lowest resolution first
 * (default scaleResolutionDownBy 4/2/1 for three layers, 2/1 for two). The
 * layer count is fixed from then on — setParameters cannot add or drop
 * encodings, and every re-offer keeps the group — so it has to be chosen here,
 * per connection (see getVideoSimulcastLayerCount). `layers <= 1` leaves the
 * offer untouched.
 */
export function addSimulcast(sdp: SDP, layers = 3) {
  if(layers <= 1) {
    return false;
  }

  let generator: UniqueNumberGenerator;
  sdp.media.forEach((section, idx) => {
    if(section.mediaType === 'video' && section.isSending && !section.attributes.get('ssrc-group').get('SIM').exists) {
      const fid = section.attributes.get('ssrc-group').get('FID').value;
      // Without an RTX pairing there is nothing to mirror per layer; leave the
      // section single-layer rather than throwing on a browser that omits it.
      if(!fid) {
        return;
      }

      if(!generator) {
        generator = new UniqueNumberGenerator(2, 4294967295);
      }

      const originalSsrcs = fid.split(' ');
      const lines = section.lines;
      originalSsrcs.forEach((ssrc) => generator.add(+ssrc)); // fix possible duplicates
      const ssrcs = [originalSsrcs[0]];
      const ssrcs2 = [originalSsrcs[1]];
      for(let i = 1; i < layers; ++i) {
        ssrcs.push('' + generator.generate());
        ssrcs2.push('' + generator.generate());
      }

      lines.push(parseSdpLine('a=ssrc-group:SIM ' + ssrcs.join(' ')));

      const ssrcsStrLines = section.attributes.get('ssrc').get(originalSsrcs[0]).lines;

      ssrcs.forEach((ssrc, idx) => {
        const ssrc2 = ssrcs2[idx];
        if(idx > 0) {
          lines.push(parseSdpLine('a=ssrc-group:FID ' + ssrc + ' ' + ssrc2));

          ssrcsStrLines.forEach((v) => {
            lines.push(parseSdpLine('a=ssrc:' + ssrc + ' ' + v));
          });

          ssrcsStrLines.forEach((v) => {
            lines.push(parseSdpLine('a=ssrc:' + ssrc2 + ' ' + v));
          });
        }
      });

      sdp.media[idx] = new SDPMediaSection(lines);
    }
  });

  return !!generator;
}

/** The `a=ssrc:<value>` attribute lines (cname, msid) of a section's first ssrc. */
function firstSsrcAttributeLines(section: SDPMediaSection) {
  const ssrc = section.attributes.get('ssrc');
  if(!ssrc.keys.length) {
    return [];
  }

  return ssrc.get(ssrc.keys[0]).lines;
}

/**
 * Align the outgoing video m-line's ssrcs with what the call server archived at
 * join — the tgcalls contract every other official client follows.
 *
 * tgcalls always pre-allocates its video ssrcs and includes them in the join
 * payload even with the camera off (tdesktop creates the main instance with
 * VideoContentType::Generic unconditionally): the server archives the
 * payload's ssrc-groups and a later video_stopped=false edit only flips the
 * active bit on that archive — no later message re-sends the ssrcs. tweb joins
 * with a trackless video transceiver instead, so Chrome allocates no ssrcs
 * for it and the join payload would carry no video groups at all: a camera
 * started after joining would never appear in any participant row, and no
 * viewer could ever receive it. Two cases to fix here:
 *
 *   - trackless (joined with the camera off): allocate the whole layer table
 *     the way tgcalls does, derived from the audio ssrc, and munge it in.
 *     Chrome adopts the declared ssrcs for the sender. The derivation is
 *     deterministic, so a re-munge of a still-trackless offer reproduces the
 *     same ssrcs the join payload archived;
 *   - a live camera whose ssrcs differ from the archived ones (Chrome ignored
 *     the munged declaration and allocated its own): rewrite the m-line back
 *     to the archived ssrcs. Ssrc munging re-seeds the sender, so the camera
 *     keeps flowing on the ssrcs the server knows.
 *
 * Returns whether the SDP was munged; the caller re-serializes it either way.
 */
export function alignOutgoingVideoSsrcs(
  sdp: SDP,
  archived?: {source?: number, sourceGroups?: GroupCallParticipantVideoSourceGroup[]},
  layers = 3
) {
  let munged = false;
  sdp.media.forEach((section, idx) => {
    if(section.mediaType !== 'video' || !section.isSending) {
      return;
    }

    const lines = alignVideoSectionSsrcs(sdp, section, archived, layers);
    if(lines) {
      sdp.media[idx] = new SDPMediaSection(lines);
      munged = true;
    }
  });
  return munged;
}

function alignVideoSectionSsrcs(
  sdp: SDP,
  section: SDPMediaSection,
  archived: {source?: number, sourceGroups?: GroupCallParticipantVideoSourceGroup[]} | undefined,
  layers: number
): SDPLine[] | undefined {
  if(!section.attributes.get('ssrc').keys.length) {
    return allocateTracklessVideoSsrcs(sdp, section, layers);
  }

  if(archived?.source === undefined || !archived.sourceGroups?.length) {
    // A live camera at join: its ssrcs ARE the archive (the join payload is
    // read from this same munged SDP). Nothing to align.
    return undefined;
  }

  // Chrome kept the declared ssrcs (or re-emitted them from its seeded
  // encodings) — the m-line already matches what the server archived.
  const fid = section.attributes.get('ssrc-group').get('FID').value;
  const primary = toTelegramSource(+(fid ? fid.split(' ')[0] : section.attributes.get('ssrc').keys[0]));
  if(primary === archived.source) {
    return undefined;
  }

  return rewriteVideoSsrcs(section, archived.sourceGroups);
}

/**
 * tgcalls derives the video ssrcs from the audio one
 * (outgoingVideoSsrcBase = audioSsrc + 1, layer i = base + i*2 with its RTX at
 * +1); same derivation here so the allocation is deterministic across
 * renegotiations while the camera stays off, cannot collide with the audio
 * ssrc itself, and lands in the archive exactly once — a re-munge of a
 * still-trackless offer reproduces the same lines, and addSimulcast skips a
 * section that already carries a SIM group.
 */
function allocateTracklessVideoSsrcs(sdp: SDP, section: SDPMediaSection, layers: number): SDPLine[] | undefined {
  if(layers < 1) {
    return undefined;
  }

  const audioSection = sdp.media.find((media) => media.mediaType === 'audio' && media.isSending);
  if(!audioSection) {
    return undefined;
  }

  const template = firstSsrcAttributeLines(audioSection);
  if(!template.length) {
    return undefined;
  }

  const audioSsrc = +audioSection.attributes.get('ssrc').keys[0];
  const base = (audioSsrc % 0x7ffffff0) + 1;
  const lines = section.lines.slice();
  for(let i = 0; i < layers; ++i) {
    [base + i * 2, base + i * 2 + 1].forEach((ssrc) => {
      template.forEach((v) => lines.push(parseSdpLine('a=ssrc:' + ssrc + ' ' + v)));
    });
  }
  if(layers > 1) {
    const simSources = Array.from({length: layers}, (_, i) => base + i * 2);
    lines.push(parseSdpLine('a=ssrc-group:SIM ' + simSources.join(' ')));
  }
  for(let i = 0; i < layers; ++i) {
    lines.push(parseSdpLine('a=ssrc-group:FID ' + (base + i * 2) + ' ' + (base + i * 2 + 1)));
  }
  return lines;
}

function rewriteVideoSsrcs(
  section: SDPMediaSection,
  groups: GroupCallParticipantVideoSourceGroup[]
): SDPLine[] | undefined {
  const template = firstSsrcAttributeLines(section);
  if(!template.length) {
    return undefined;
  }

  const lines = section.lines.filter((line) => {
    return !(line.key === 'a' && (line.parsed.key === 'ssrc' || line.parsed.key === 'ssrc-group'));
  });

  const seen = new Set<number>();
  groups.forEach((group) => {
    group.sources.forEach((source) => {
      const ssrc = fromTelegramSource(source);
      if(seen.has(ssrc)) return;
      seen.add(ssrc);
      template.forEach((v) => lines.push(parseSdpLine('a=ssrc:' + ssrc + ' ' + v)));
    });
  });

  // tgcalls order: the SIM group first, then the FID pairs.
  const sim = groups.find((group) => group.semantics === 'SIM');
  if(sim) {
    lines.push(parseSdpLine('a=ssrc-group:SIM ' + sim.sources.map((source) => fromTelegramSource(source)).join(' ')));
  }
  groups.forEach((group) => {
    if(group.semantics === 'SIM') return;
    lines.push(parseSdpLine('a=ssrc-group:' + group.semantics + ' ' + group.sources.map((source) => fromTelegramSource(source)).join(' ')));
  });

  return lines;
}
