# Final video edit notes

## Founder export

`Screenmate_Founder_YC.mp4` is 59.90 seconds at 832 by 464, 30 fps. It preserves the continuous on-camera delivery from the supplied `C:\Users\chauh\Downloads\Screenmate.mp4`, trims the end to stay under one minute, lightly adjusts the picture, and applies gentle noise reduction and voice-level balancing. There are no internal picture cuts, music, or promotional graphics. The original recording was not modified.

Measured final audio: -16.82 LUFS integrated, -1.99 dBTP peak. H.264 video, AAC mono 48 kHz audio, fast-start MP4. The supplied source resolution is preserved.

## Animated product demo

`Screenmate_Product_Demo_YC.mp4` is 41.90 seconds at 1920 by 1080, 30 fps. It uses excerpts of the founder's own speech, without synthetic voice generation or voice cloning. Spoken words retain their original speed and pitch. Captions follow the selected narration.

Visual treatment: staggered title fades and upward movement, sliding section headings, gentle 4% camera pushes toward the assistant, 0.35-second crossfades, and a closing title. Transitions preserve the planned narration timing. No music competes with the voice.

Measured final audio: -16.91 LUFS integrated, -1.99 dBTP peak. H.264 video, AAC mono 48 kHz audio, fast-start MP4.

## Demo timing

| Time | Scene |
| --- | --- |
| 0:00-0:04.2 | Animated introduction and recognition |
| 0:04.2-0:11.2 | The application stays in view |
| 0:11.2-0:15.2 | Read what the form needs |
| 0:15.2-0:22.2 | Fill details from the saved profile |
| 0:22.2-0:27.4 | Draft answers and verify changes |
| 0:27.4-0:33.9 | Personal decisions stay with the applicant |
| 0:33.9-0:38.9 | Review before submission |
| 0:38.9-0:41.9 | Animated closing |

The product source is `demo/screenmate-demo.mp4`, an actual recorded execution on the controlled sample in `fixtures/workday.html`. Time is condensed and some frames are held to fit the narration. It is not a production Workday recording, a new live-site reliability test, or a speed benchmark. The disclosure appears throughout the walkthrough.

Both files passed full decode checks. Final frames, captions, and transitions were visually inspected; narration was checked through local transcription and audio measurements. Listen once on your own device before uploading. Optional subtitle files are included; the product demo already contains visible captions.
