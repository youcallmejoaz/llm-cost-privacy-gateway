# Proposal cut: script

A 60 to 90 second cut for proposals: the problem, the result working, the safeguards, the offer. Built only from the Phase 3 clips. Neutral voice, no captions or subtitles, no music, no names, no contact details.

Rendered by `clips/render_proposal_cut.py` (voice: Kokoro TTS, `am_michael`, speed 1.0). Each scene lasts as long as its narration plus 0.5 seconds; UI scenes (2 to 6) may get up to 1.5 seconds more if the total is under 60 seconds.

| Scene | Clips | Narration |
|---|---|---|
| 1 | K01 | If your company uses AI in several places, the bills grow every month, and personal data is going out to more than one vendor. |
| 2 | C01, C02 | This gateway sits between your apps and the AI providers. Your apps change one setting, and every request now goes through it. |
| 3 | C03 (close up), C04 | Simple jobs go to cheaper models, repeated questions come from cache, and you can see the savings per team. |
| 4 | C05 | Personal details like card numbers and emails are removed before anything leaves, and put back in the answer. |
| 5 | C06 | Each team gets a budget, and it is enforced before money is spent. |
| 6 | C07 | And if a provider goes down, requests switch to another one, so your apps keep working. |
| 7 | K04 | If you want control over your AI spend and data, reply to this proposal, and we can map it to your setup. |

Edit rules:

- Hard cuts, except a 0.3 second crossfade from the opening card into the first UI shot.
- A slow 5 percent push in on any shot longer than 8 seconds.
- Clips are trimmed or hold their last frame to fit; footage is never sped up.
- Voice only, loudness normalised to about -16 LUFS. 1920 x 1080, 30 fps, H.264 yuv420p, AAC, faststart.
