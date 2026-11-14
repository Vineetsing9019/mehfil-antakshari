// Original songs the bots can sing. The lyrics are written for Mehfil, not copied from any film,
// so they can be used freely. The bots speak them in a browser voice (no recording is stored).
// Each song starts with the letter it is listed under, so a bot can sing it when that letter is in play.
const LIBRARY = [
  {
    id: 'dhoop-ki-chadar', title: 'Dhoop Ki Chadar', lang: 'hi',
    lines: [
      'Dhoop ki chadar odh ke aaye',
      'Chaand se hum ne baat banaayi',
      'Dil ki gali mein roshni bhar do',
      'Tum bhi gaao, main bhi gaaun',
    ],
  },
  {
    id: 'mann-ka-mela', title: 'Mann Ka Mela', lang: 'hi',
    lines: [
      'Mann ka mela lagta hai aaj',
      'Sab milke gaao, koi na ho akela',
      'Taal pe taali, dhun pe naach',
      'Sur mein sur mila ke baat bana',
    ],
  },
  {
    id: 'sakhi-re', title: 'Sakhi Re', lang: 'mr',
    lines: [
      'Sakhi re, ya ga sobat tu',
      'Pavsat gaato, gaana gaato',
      'Aabhal bharla, mana bharla',
      'Sur ghe majhya sobat',
    ],
  },
  {
    id: 'tell-me-once', title: 'Tell Me Once', lang: 'en',
    lines: [
      'Tell me once, the song is free',
      'Sing it loud and let it be',
      'Two hearts humming, one small tune',
      'Under the moon we sing till noon',
    ],
  },
  {
    id: 'kaagaz-ki-naav', title: 'Kaagaz Ki Naav', lang: 'hi',
    lines: [
      'Kaagaz ki naav, paani ka gaana',
      'Bachpan wala dil ka tarana',
      'Kal ki baat, aaj ka mausam',
      'Kho jaate hain, phir se milte hain',
    ],
  },
];

// Songs the bots can sing for a letter, not yet sung at this table.
function librarySongsFor(letter, usedTitles = []) {
  const used = new Set(usedTitles.map(s => s.toLowerCase()));
  return LIBRARY.filter(s => s.title[0].toUpperCase() === letter && !used.has(s.title.toLowerCase()));
}

module.exports = { LIBRARY, librarySongsFor };
