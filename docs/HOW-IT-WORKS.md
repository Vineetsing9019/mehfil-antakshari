# How Mehfil works

A short tour of the inside: how a game runs, how voices travel, how the AI singers sing, how it stays fast,
and the real problems found while building it (and how each was fixed).

## 1. One server keeps the game fair

Every table lives on the server (`server.js`), not on the phones. Phones send what the player did
("I sang this song", "I vote yes") over **Socket.IO**, and the server sends each person their own view of the table back.
So nobody can cheat by changing the page, and a phone that drops off can come back to exactly the same game.

- **Turns and timers.** Each turn has a timer on the server. Run out of time and you lose a life.
- **Votes.** When you finish, everyone else votes for 6 seconds. A song is only rejected if more people vote no than yes.
- **The next letter by sound.** The next singer starts with the last *sound* of your last word, so trailing vowels
  are skipped: "pyaar" gives **R**, "hai" gives **H**. You can also pick any letter A to Z yourself.
- **Reconnecting.** If your connection drops, your seat is kept for 60 seconds. Come back with the same browser
  and you are in the same seat with the same score.
- **Privacy per person.** Each player gets their own view: blocked people's chat is hidden, and only the singer
  whose turn it is gets the title suggestions.

## 2. Voices travel phone to phone (WebRTC)

The server never carries voices. Each pair of players opens a direct **WebRTC** audio link (a "mesh"), so a table
sounds like a group phone call. The server only passes the setup messages between phones.

- To avoid both phones calling each other at once, only one of each pair starts the call (the one with the smaller id).
- The microphone is attached with `replaceTrack`, so it can be turned on and off without setting the call up again.
- Singing sounds better without speech filters: noise suppression and auto-gain are off, echo cancellation stays on,
  and the audio quality is raised to 128 kbps.
- On mobile data, phones often can't reach each other directly, so a relay server (TURN) is used.
- **Video** uses a second slot next to the audio slot, set up with the call, so turning a camera on or off never
  disturbs the voice. Video is small and smooth for phones (about 320x240, 15 frames a second, 300 kbps).
- **Video rules:** cameras start off and the server allows at most 4 per table. At an open table the app asks first
  ("anyone who joins can see you"); at a link-only table the camera turns on straight away.

## 3. AI singers

There are 20 AI singers, each clearly labelled **AI** (no fake blue ticks or followers).

- **Songs.** 101 original Mehfil songs in Hindi, Marathi and English (`songlib.js`), each with a verse and a chorus
  (`chorus.js`). No film songs are copied, so there are no copyright problems.
- **Picking a song.** On its turn, an AI singer picks an unused library song that starts with the current letter.
  On Easy it sometimes gets stuck; on Hard almost never.
- **Singing.** The phone's own voices read the lyrics aloud (Web Speech API), one line at a time, with a slightly
  different pitch per line so it sounds sung rather than read. Each of the 20 singers has its own pitch, speed and voice.
- **Karaoke.** Each line lights up as it is spoken (`onstart` of each spoken line), and the box switches to "Chorus".
- **Timing.** The server estimates how long the song takes (about 0.07 s per character plus a pause per line)
  and ends the AI singer's turn when the song is over.

## 4. Fast on a phone

Measured with a simulated 4G connection and a processor slowed down 4x (like a mid-range phone):
the first screen is ready in **about 0.8 s on a first visit and 0.4 s on later visits**.

- Files are compressed (gzip) and the smaller (minified) Socket.IO client is used.
- Fonts load without holding up the page.
- The first screen shows straight away: new visitors get the name box, returning players get their home screen
  from the last saved copy, without waiting for the server.
- A service worker keeps a copy of the app, so it opens instantly next time and still opens with no internet.

## 5. Safety

- **16+ only.** Every time Mehfil opens it asks "Are you 16 or older?" before anything else. The live connection to the
  server only starts after "Yes", so nothing (not even an invite link) can put someone at a table before they answer.
  "No" shows a kind message and no way in. It is asked again whenever the app is opened, but not when it refreshes itself.
- Tables can be **link-only** (not listed for strangers). Play now games are link-only by default.
- **Mute** one person just for yourself; **block** and **report** from any profile, including by tapping a name in chat.
- A **bad-word filter** stars out common English, Hindi and Marathi abuse in chat, names, cities and bios.
  It was tuned so real names are not hit (for example "Shitij" and "Randip" are left alone).
- Avatars are drawn in the browser from initials, so no one's name is sent to an outside avatar service.

## 6. How it is tested

- **Server checks** (`npm test`, 79 checks): the test starts its own server on a spare port with throwaway data,
  connects several fake players and plays real flows: joining by link, votes, lives, AI singers, skip,
  invites during a game, link-only tables, the bad-word filter, badges, the daily challenge, the QR code.
- **Browser checks** (`npm run e2e`, 121 checks): headless Chrome at phone size, with a fake microphone.
  They check what a person sees: each screen fits the phone, there is exactly one main button per screen,
  nothing scrolls sideways, the karaoke line lights up, leaving stops the AI singer's voice, sharing makes a picture,
  and there are no page errors.

## 7. Real problems found and fixed

| Problem | Cause | Fix |
|---------|-------|-----|
| Only one person could hear the other | The phone answering the call added its own audio slot instead of using the caller's | Answer on the caller's audio slot, then attach the mic to it |
| Friends showed "Muted" | Games still had a take-turns voice mode | Every table became a call: everyone talks |
| AI voice buzzed between lines | All lines were queued at once | Speak one line, wait for it to end, then the next |
| AI singer repeated the same 4 lines | Songs only had 4 lines and were looped to fill 30 s | Wrote a chorus for every song: verse, chorus, chorus |
| AI singer kept singing after you left | Lines already queued kept playing | Every song has a number; leaving changes it, so old lines stop |
| Timer ring froze | A code patch turned `$$(` into `$(` (JavaScript's `replace()` treats `$$` specially), so the seat-glow code crashed every frame | Found by the browser checks; fixed, and patches now use `split/join` |
| App crashed when opened offline | The live-connection library wasn't saved for offline use | It is saved now, and the app runs with a stand-in until the connection is back |
| Home grew longer than the screen | Every open table and online friend added a box | One row of singers, one open table plus "See all" |
| Video tiles showed but nothing was sent | Headless Chrome's fake camera ends at once, so the test could not tell | A read-only call-statistics helper counts video bytes sent and frames decoded; the test uses an animated canvas as the camera and proves video flows both ways |
| Signing up did nothing on the live site | To feel fast, the first screen appears before the live connection is ready; a quick tap sent the name before the app said hello, so the server ignored it. Locally the connection is instant, so it never showed up | Every action waits in an outbox until the server answers hello, then goes in order. A test on a slowed-down connection reproduces it (fails on the old version, passes now) |
| After a deploy, people still saw the old version | To open instantly, the app shows its saved copy first and fetches the new one in the background | The background fetch compares version tags (ETag); if the page or app script changed, the app refreshes itself on home, or after you leave a table. A test simulates a deploy and checks it refreshes once, with no loop |
| Link-only table codes were visible to everyone | The home screen sent each person's table code to all players | Codes are only sent for open tables; a server check makes sure of it |
| Page error on fast screen changes | A second screen change cancels the first cross-fade | Cancelled fades are ignored; the screen still changes |

## 8. What's next

- Real sung audio for the AI singers (needs a singing service with commercial rights).
- A database instead of `data.json`, and its own TURN relay, before a big launch.
- Play Store and App Store versions (the same web app, wrapped).
