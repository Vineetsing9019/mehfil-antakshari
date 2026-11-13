# Mehfil: master prompt and product spec (v2)

This is the single brief for the app. Every change should be checked against it.

## 1. Product
Mehfil is a free Antakshari (Hindi film-song word game) and sing-along app. Friends
join a table by tapping a link shared on WhatsApp, take turns singing, vote on songs, chat
and react. It works in any browser, can be installed on a phone, and later ships as an
Android and iOS app named **Mehfil**.

Users: singers (want a clear turn and clear rules), hosts (start and share tables, set
rules, remove people), and listeners (join to listen, chat and react).

## 2. Tables
1. **Game table (Antakshari), 2 to 6 singers.** Turn-based, like carrom: one singer holds
   the mic at a time. The song's first letter must match the current letter. The next letter
   comes from the last word's sound (skip trailing vowels: "hai" gives H, "pyaar" gives R).
   Lives, points, optional teams (Team A vs Team B), hints, winner, crowd favourite.
2. **Jam table (sing-along), 1 to 8 people.** One open room: anyone can take the stage
   (one lead at a time), add songs to a shared queue, open or push-to-talk mic, chat and react.
   No lives, no turns.

Every table has a 6-character code and the link `/?t=CODE`. Opening the link joins the table.
A WhatsApp button shares the link with a short message. Profiles have links `/?u=username`.

## 3. Game rules
- Host settings (before the game): theme (Classic, Rapid Fire 20 s, Dhun, Decade 90s,
  Actor), turn length (20, 30, 60 or 90 s), lives (1 to 5), teams, letter script
  (English, Hindi, Marathi).
- A submitted song goes to a 6-second vote. Everyone except the singer votes 👍 or 👎.
  The song is rejected only if 👎 outnumber 👍; a rejected song costs a life and the turn passes.
  Bots always vote 👍. With bots only, the song counts at once.
- Points: 10 per accepted song, +5 if sung in the first third of the turn.
- Hint: 3 unused titles for the letter, costs 5 points, shown only to the singer.
- Clap meter: reactions during a turn fill a bar; the most applauded singer gets
  "Crowd favourite".
- Only the singer's mic is live. Bot singers hum a short tune while "singing".
- Themes Dhun, Decade and Actor are rules shown to the table; they are enforced by the
  listeners' votes, not by a song database.

## 4. Accounts and profiles
- A device token identifies a person. A dropped connection keeps the seat, lives and score
  for 60 seconds, and reconnecting restores them.
- Profile: name (required), unique username, city, bio, photo (upload or selfie, cropped and
  resized) or a default avatar, up to 9 posts. Badges: First song, Ten songs, Winner,
  Never passed, Regular.
- Follow people; a followed person coming online triggers an alert.
- Block: both people disappear from each other's lobby, cannot invite or join each other's
  tables, and do not see each other's chat. Report sends a note to the operator (reports file).

## 5. Lobby
- Start a game table, start a jam, join by code, list of open tables.
- "Active now" people: followed first, then free people.
- Request (invite) a free person; if they accept, both sit at one table.
- Weekly leaderboard (points this ISO week).

## 6. Privacy and safety (must hold before public launch)
- No real names or phone numbers are required. Usernames are public.
- Photos are validated (JPEG, PNG, WebP; under about 1 MB each) and never shown raw to
  others until uploaded by that person.
- Every typed value is escaped on display and length-limited on the server.
- Reports are stored and reviewed by the operator; a block is instant and private.
- Children: the app asks nothing sensitive; a short notice says it is for ages 13 and up.
- Terms and privacy page: what is stored (name, username, city, bio, photos, stats, reports),
  how to delete it (the Delete profile button), and who to contact.

## 7. Scale and reliability target: 100,000 users
The app must be built so it can grow to about 100,000 registered users and several thousand
online at once.
- Stateless HTTP pages; static assets behind a CDN.
- Real-time over Socket.IO. For more than one server process, use the Socket.IO Redis adapter.
- Storage: move `data.json` to a managed database (Postgres or Supabase) before large
  growth. Photos go to object storage, not the database.
- Voice: WebRTC mesh for small tables is fine (up to 8). A TURN relay is required for
  mobile data; keep the TURN credentials on the server.
- Rate limits on socket events (chat, reactions, invites) and on HTTP routes.
- Health check (`/config`), error logging, and a restart policy on the host.
- Load test: at least 1,000 simultaneous sockets in 200 tables before launch.

## 8. Public review and launch plan
Phase A, review (now): deploy to a free host (Render) with a `.onrender.com` link, add search
tags and sitemap, share the link for testers to review.
Phase B, store apps: wrap the same web app as **Mehfil** for Google Play (Android App Bundle)
and the Apple App Store (iOS). Needs a Google Play Console account (one-time fee) and an Apple
Developer Program account (yearly fee); both are created by the owner.
Phase C, search: Google Search Console, sitemap, and a custom domain (optional).

## 9. Quality bar
- Works on a 390 px phone and on desktop; no horizontal scroll.
- Clear empty, loading and error states. Every action gives feedback.
- Accessible: 44 px tap targets, readable contrast, labels on icon buttons, respects reduced motion.
- No paid service required to run the core app.

## 10. Acceptance tests
`tests/flow-test.js` covers: table code join, game start and turn order, vote rejection and
acceptance, hint cost, team mode, jam capacity of 8 (9th refused), block, report, reconnect within
60 s, follow alert, leaderboard, and persistence across restart.
