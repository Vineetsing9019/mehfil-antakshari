# Mehfil v3: build prompt

Use this brief for every change to Mehfil. It sits on top of `docs/SPEC.md`.

## Who it is for
New users who have never played Antakshari, on a phone, opening a WhatsApp link. They should be
singing within 30 seconds without reading anything.

## Goals
1. **Simple first screen.** Two big choices: **Antakshari game** (take turns) and **Sing together**
   (everyone talks, like a call). Plus a box to type a table code. Nothing else above the fold.
2. **Start is always at the top.** When you are the host of a game table in the lobby, the
   **Start game** button sits in the table's top bar, not at the bottom of the page.
3. **Leave is always at the top.** **Leave table** is in the top bar during the game too, so
   anyone who doesn't want to sing can step out at any moment.
4. **Voices like a call (Sing together).** Everyone's mic is on when they join, and everyone
   hears everyone. A mute/unmute button is always visible.
5. **Game voices can be either mode.** The host chooses in settings:
   - **Take turns:** only the singer is heard (the original carrom-style game).
   - **Everyone talks:** every mic is on, like a call, while the game runs.

## Layout rules
- One primary button per screen (black or gold). Everything else is secondary or text.
- Button labels are plain words: "Start game", "Leave table", "Mute", "Share on WhatsApp".
- No jargon in the lobby. Put the rules in one short "How to play" card with three steps.
- Every table screen works at 390 px wide with no sideways scrolling.

## Screens
**Lobby:** "Let's sing!" card with the two modes and the code box. Below: open tables, singers
online, this week's board.

**Table top bar:** table code and type · Start game (host, lobby only) · Share on WhatsApp ·
Copy link · Mic check · Music · Leave table.

**Table body:** stage (seats, timer, letter), then the action card, singers list, chat and
reactions, and the side card (settings for the host, song trail or queue).

## Voice rules
| Table | Voice | Who is heard |
|---|---|---|
| Sing together (jam) | Everyone talks | Everyone with mic on |
| Game, "Take turns" | Singer only | The current singer |
| Game, "Everyone talks" | Everyone | Everyone with mic on |

- Mic is on by default in the first two rows above, and in "Everyone talks". Mute is one tap.
- Mic permission is requested when a table opens. If it is refused, say so in plain words.

## Acceptance tests (run before saying done)
- `npm test` passes (flow tests, including the voice setting).
- Browser run on a 390 px screen: Start game is in the top bar for the host; Leave table is
  visible during a game; the lobby shows the two modes and the code box; no overflow.
- Two browsers: in "Sing together" both people hear each other (mic on by default).
- Two browsers: in a game set to "Everyone talks" both are unmuted; in "Take turns" only the
  singer's mic is live.
- A person who taps Leave table during a game is removed and the game continues.
- Host can change voice mode and it applies to the next game.

## Do not
- Do not add a new account or login.
- Do not add paid services.
- Do not push to any account except `Vineetsing9019/mehfil-antakshari`.
