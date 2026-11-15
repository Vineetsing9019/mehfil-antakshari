# Mehfil: UX and product changes (15 Nov 2026)

Written for: the Mehfil owner and whoever builds Mehfil next.

Each change says what is wrong today, what to do, and why it helps a new user. Status is filled in as changes are built and tested.

Status: **Done** = built and checked in the browser (phone size) and by the tests · **Built** = in the code, not yet checked on a real phone · **Open** = not built yet.

## A. First visit

| # | Change | Why | Status |
|---|--------|-----|--------|
| 1 | First screen asks only for a name. Username, photo, city, bio and photos move to Edit profile. | Every extra field loses people. Instagram and WhatsApp ask for the minimum first. | Done |
| 2 | Avatar preview shows the initials of the name as it is typed. | Instant feedback makes the form feel alive. | Done |
| 3 | Name field is focused, Enter submits. | One less tap. | Done |
| 4 | Replace the duplicate "Mehfil" title with a promise: "Antakshari with friends, anywhere". | The logo is already at the top; the space should say what you get. | Done |
| 5 | Fix the wrong note "Mic opens only on your turn" (everyone talks now). | Wrong promises break trust on the first screen. | Done |
| 6 | When opened from a WhatsApp link, show "You're invited to table K7PQ2M". | People need to know why they are typing a name. | Done |
| 7 | Move the long About text into a closed "About Mehfil" section. Keep it for Google. | The action stays above the fold; search still reads the text. | Done |
| 8 | Show a short loading screen until the server answers. | Returning users no longer see the sign-up form flash. | Done |
| 9 | No "Profile saved" toast after first sign-up; greet by name instead. | A greeting feels personal; a toast feels like a form. | Done |

## B. Lobby (home)

| # | Change | Why | Status |
|---|--------|-----|--------|
| 10 | One primary button: "Play now" starts a game with 2 AI singers at once. | New users want to play in seconds, not wait for friends. One clear first action. | Done |
| 11 | "Play with friends" and "Sing together" become secondary choices under it. | Clear hierarchy: one main path, two others. | Done |
| 12 | Join by code goes behind a small "Have a code?" link. | Most people arrive by link; the code box is for a few. | Done |
| 13 | Hide "Open tables" when there are none. | Empty boxes make the app feel dead. | Done |
| 14 | Split the list into "Friends online" (real people) and "AI singers". | People should always know who is real. | Done |
| 15 | AI singers get an "AI" badge. No blue tick or follower counts on them. | Honest labels build trust and help app-store review. | Done |
| 16 | "Request" becomes "Invite", as a small outline button, not 12 orange buttons. | One primary per screen; the right word for the action. | Done |
| 17 | Search box only appears when more than 8 real people are online. | No tool before it is needed. | Done |
| 18 | "How to play" becomes 3 short steps. | Faster to read. | Done |
| 19 | Leaderboard empty state invites you to play. | Turns an empty box into a reason to act. | Done |

## C. Table: waiting room

| # | Change | Why | Status |
|---|--------|-----|--------|
| 20 | Waiting room primary: "Invite on WhatsApp". Secondary: "Add AI singer". Tertiary: "Copy link". | Sharing was hidden inside Settings; it is the most important action when alone. | Done |
| 21 | Alone at a table: "Add an AI singer to start" instead of a disabled Start button. | A disabled button with no reason is a dead end. | Done |
| 22 | Tap the table code to copy the link. | People expect codes to be copyable. | Done |
| 23 | Leaving during a game asks to confirm. | Stops accidental exits that lose your seat. | Done |

## D. Table: playing

| # | Change | Why | Status |
|---|--------|-----|--------|
| 24 | Your turn: the last word fills in from the song title; you can change it. | Most people only want to type the song. | Done |
| 25 | Pass becomes a quiet text button; Hint stays an outline button; Done is the one primary. | Losing a life should never be the easy tap. | Done |
| 26 | Bot lyrics highlight the line being sung, like karaoke. | Feels live and premium; easy to follow. | Done |
| 27 | "AI voice" on/off in Settings, remembered on the device. | Some people do not want spoken lyrics. | Done |
| 28 | AI badge on bot seats at the table. | Always clear who is real. | Done |
| 29 | Show the last song and who sang it under the letter. | Context for the next singer. | Done |
| 30 | Screen-reader announcement when it is your turn. | Accessibility. | Done |
| 31 | Toasts sit above the bottom bar on the table, not on top of it. | Nothing should hide the controls. | Done |

## E. Game over

| # | Change | Why | Status |
|---|--------|-----|--------|
| 32 | "Share result on WhatsApp" after a game. | Every finished game can bring a new player. | Done |
| 33 | Game over with AI singers: "Play again" is the one primary for the host. | Keeps the fun going. | Done |

## F. Look and feel

| # | Change | Why | Status |
|---|--------|-----|--------|
| 34 | Secondary buttons become neutral white outlines; teal only means "live" (mic on, online). | Colour should carry meaning, not decoration. | Done |
| 35 | Respect iPhone safe areas for the bottom bar. | The bar must not sit under the home indicator. | Built |
| 36 | Quick-chat chips at least 40 px tall. | Easy to tap. | Done |
| 37 | A slim "Reconnecting…" bar instead of repeated toasts. | Calm, clear status. | Done |
| 38 | Avatars drawn in the browser, not loaded from an outside service. | Faster, works offline, and names are no longer sent to another company. | Done |

## Also fixed after looking at the screenshots

| Change | Status |
|--------|--------|
| Song title no longer squeezed inside the circle while a bot sings; it heads the lyric box | Done |
| Timer ring a little smaller, so the top seat no longer covers "Start with" | Done |
| On your turn the page scrolls so Done sits above the bottom bar | Done |
| "Start with the letter in the middle" no longer repeated for classic games | Done |
| No "Table ready" toast repeating what the waiting room says | Done |
| Lobby shows 6 AI singers with "See all 12"; choice cards are compact rows | Done |
| Box under the circle says what to do ("Listen and cheer"), not who is singing again | Done |

## H. Shorter screens (15 Nov)

| Change | Status |
|--------|--------|
| Home fits one phone screen: Play now, two small choices, one row of round AI singer avatars | Done |
| This week and How to play open as small pop-ups instead of long boxes | Done |
| Join screen: title, one line, name box; the three notes removed | Done |
| Shorter messages on the table screens | Done |

## G. Later (needs more time, money or accounts)

| # | Change | Why | Status |
|---|--------|-----|--------|
| 39 | Real sung audio for the 101 library songs. | Speech is not singing. Needs a singing service with commercial rights. | Open |
| 40 | Hindi/Marathi letter display toggle wired to the letter in the middle. | Setting exists but is not shown on the stage. | Done |
| 41 | Dhun, Decade and Actor rules checked by the table vote prompt. | Themes are labels only today. | Done |
| 42 | Your own TURN relay before public launch. | Voice on mobile data depends on it. | Open |
| 43 | Saved data survives host restarts (database). | Free hosting resets files. | Open |
| 44 | Play Store and App Store apps. | Needs developer accounts. | Open |
| 45 | Friends list: see when people you follow are online, invite in one tap. | Brings people back. | Done |
| 46 | Daily streak and a gentle reminder to come back. | Habit. | Done (streak; no reminder notifications yet) |
| 47 | Short tutorial the first time someone gets a turn. | Teaches by doing. | Done |
| 48 | Song suggestions from the library as hints, not just film titles. | Hints should help anyone. | Done |
| 49 | Rooms by language (Hindi, Marathi, English). | People find their crowd. | Done (language shown on each open table) |
| 50 | Host can lock a table to invited people only. | Privacy for family games. | Done |
| 51 | Report and block reachable from every chat message. | Safety at scale. | Done |
| 52 | Profanity filter for chat and names. | Safety at scale. | Done |
| 53 | Weekly winner shown on the home screen. | Social proof. | Done |
| 54 | Audio level meter on each seat while people talk. | Shows who is speaking. | Done |
| 55 | Offline page when there is no internet. | Clear message instead of a broken screen. | Done |

## I. Next 20 changes (15 Nov, after testing the new screens)

| # | Change | Why | Status |
|---|--------|-----|--------|
| 56 | Every bot song gets a chorus, so a bot sings verse + chorus with no line repeated over and over. | Hearing the same 4 lines for 30 seconds is boring. | Done |
| 57 | Each line is spoken at a different pitch, so the bot sounds more like singing than reading. | Feels more musical with the same free voice. | Done |
| 58 | Soft tanpura and dholak play under the bot's voice. | Music makes it feel like a performance. | Open |
| 59 | "Skip ⏭" on a bot's turn. | Nobody should wait 30 seconds for a bot they don't want to hear. | Open |
| 60 | Bots say something in chat after a good song ("Wah! 👏"). | The table feels alive even with only AI singers. | Open |
| 61 | "+10" / "+15 fast" pops up when your song is accepted. | Instant reward. | Open |
| 62 | Tick sound and buzz in the last 5 seconds of your turn. | You notice time running out without looking. | Open |
| 63 | Songs sung this game, listed on the Game over screen. | A nice recap to share. | Open |
| 64 | Share button uses the phone's own share sheet (WhatsApp, Instagram, SMS…). | Not everyone uses WhatsApp. | Open |
| 65 | Mute one person at the table (only for you). | Calls need this when someone is noisy. | Open |
| 66 | Speak the song title instead of typing it (🎤 button, where the browser supports it). | Typing while singing is hard. | Open |
| 67 | Song suggestions while typing the title. | Faster, fewer spelling mistakes. | Open |
| 68 | Bot difficulty for Play now: Easy / Normal / Hard. | Beginners win sometimes; experts get a challenge. | Open |
| 69 | "Add to home screen" prompt after your first game. | Brings people back like an app. | Open |
| 70 | Big table code and a QR code to join at a party. | Easy for people in the same room. | Open |
| 71 | Badge pop-up when you earn one (First song, Winner…). | Celebrates progress. | Open |
| 72 | Daily challenge: one letter a day, keep your streak. | A reason to come back daily. | Open |
| 73 | Non-hosts can ask for a rematch. | The game shouldn't stall on the host. | Open |
| 74 | Photo nudge after the first game ("Add a photo so friends know you"). | Asked at the right time, not at sign-up. | Open |
| 75 | Sound effects on/off in Settings. | Some people play in quiet places. | Open |
