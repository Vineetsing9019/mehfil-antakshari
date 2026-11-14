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
  { id: 'aasmaan-ki-chhaon', title: 'Aasmaan Ki Chhaon', lang: 'hi', lines: ['Aasmaan ki chhaon mein baithe', 'Taare ginte, baatein karte', 'Hawa bhi ruk ke sun rahi hai', 'Dil ki sargam, aaj hai pyaari'] },
  { id: 'aaja-re-baadal', title: 'Aaja Re Baadal', lang: 'hi', lines: ['Aaja re baadal, dhool uda de', 'Mitti mein khushboo phir jaga de', 'Chhata barse, gaaon gaaye', 'Sab ke mann mein rang jagaaye'] },
  { id: 'bheege-pal', title: 'Bheege Pal', lang: 'hi', lines: ['Bheege pal hain, bheegi raat', 'Chhoti si ek mulaqat', 'Haath mein haath, dil mein geet', 'Yaad rahegi yeh preet'] },
  { id: 'basanti-mausam', title: 'Basanti Mausam', lang: 'hi', lines: ['Basanti mausam aa gaya', 'Phoolon ne geet gaa liya', 'Bhanwre bole, mann dole', 'Aao saath mein jhoole'] },
  { id: 'chhoti-si-baat', title: 'Chhoti Si Baat', lang: 'hi', lines: ['Chhoti si baat, lambi kahani', 'Aankhon mein hai ek nishani', 'Kuch kehna tha, keh na paaye', 'Gaana bankar jo aaye'] },
  { id: 'chalo-chale', title: 'Chalo Chale', lang: 'hi', lines: ['Chalo chale, raah pukaare', 'Dhoop chhaaon, saath humaare', 'Manzil door, par dil paas', 'Sur mein chalna, yahi hai aas'] },
  { id: 'dhadkan-ki-dhun', title: 'Dhadkan Ki Dhun', lang: 'hi', lines: ['Dhadkan ki dhun pe nachenge', 'Taal mein taal milaayenge', 'Dhol bajega, mann bhi gaaye', 'Dil ka geet sab ko bhaaye'] },
  { id: 'dostana-ka-gaana', title: 'Dostana Ka Gaana', lang: 'hi', lines: ['Dosti ka gaana gaaye', 'Haath mein haath, saath nibhaaye', 'Purani yaadein, nayi baatein', 'Yaaron ke saath hi raatein'] },
  { id: 'ek-chai-ki-pyali', title: 'Ek Chai Ki Pyali', lang: 'hi', lines: ['Ek chai ki pyali le lo', 'Thodi si baat, thodi si ho', 'Adrak wali, meethi meethi', 'Dil ki baat, shaam ki preeti'] },
  { id: 'eh-re-mann', title: 'Eh Re Mann', lang: 'mr', lines: ['Eh re mann, ye gaa na', 'Vaarya sobat, dhun dhun', 'Chandane bhari raat aaj', 'Sur majhe majhya saath'] },
  { id: 'fursat-ke-pal', title: 'Fursat Ke Pal', lang: 'hi', lines: ['Fursat ke pal ab mile hain', 'Yaaron ki mehfil khuli hai', 'Ek gaana aur ek chai', 'Yahi toh hai asli kamai'] },
  { id: 'firdaus-ki-raat', title: 'Firdaus Ki Raat', lang: 'hi', lines: ['Firdaus jaisi yeh raat hai', 'Sitaron ki barat hai', 'Sur bhi hain aur saaz bhi', 'Aao gaayein aaj sabhi'] },
  { id: 'gaon-ki-galli', title: 'Gaon Ki Galli', lang: 'hi', lines: ['Gaon ki galli, mitti ki khushboo', 'Bachpan ki yaadein, sab ko chhoo', 'Neem ki chhaon, kua ka paani', 'Gaate hain sab, yeh hai kahani'] },
  { id: 'gaatey-raho', title: 'Gaatey Raho', lang: 'en', lines: ['Keep on singing, keep it loud', 'Let the crowd join in the crowd', 'Every voice has its own grace', 'Gaatey raho, keep the pace'] },
  { id: 'hawa-ke-sang', title: 'Hawa Ke Sang', lang: 'hi', lines: ['Hawa ke sang sang udte jaayein', 'Baadlon se baatein karte jaayein', 'Kho na jaaun, yeh vaada hai', 'Tum bhi aao, mazaa hai'] },
  { id: 'hasi-ki-bahar', title: 'Hasi Ki Bahar', lang: 'mr', lines: ['Hasi ki bahar aali', 'Gaanyachi mehfil rangli', 'Dhol tasha, naach gaana', 'Ek saath sagla jamaana'] },
  { id: 'ik-taara-hai', title: 'Ik Taara Hai', lang: 'hi', lines: ['Ik taara hai, aankhon mein', 'Chamke hai raaton ki baahon mein', 'Jhilmil roshni dil ko chhoo le', 'Sapne saare saath mein dhoo le'] },
  { id: 'iss-shaher-mein', title: 'Iss Shaher Mein', lang: 'hi', lines: ['Iss shaher mein bheed bahut hai', 'Par gaane mein dil ka geet hai', 'Ek awaaz jo sab ko chhoo le', 'Sur ka jaadu sab ko mile'] },
  { id: 'jhoom-le-dil', title: 'Jhoom Le Dil', lang: 'hi', lines: ['Jhoom le dil, jhoom le raat', 'Gaane lagi hai yeh baat', 'Thaam le haath, chal re saathi', 'Naachenge hum saari saathi'] },
  { id: 'jaago-re', title: 'Jaago Re', lang: 'mr', lines: ['Jaago re, uth ga sakhya', 'Sur gheun ya gaanyat', 'Dhun vajte mann dolte', 'Jagaat raat pan gaate'] },
  { id: 'kal-ki-baat', title: 'Kal Ki Baat', lang: 'en', lines: ['Tomorrow feels so far away', 'Let us sing the night away', 'Hold my hand and hum along', 'This small song will make us strong'] },
  { id: 'khushbu-si', title: 'Khushbu Si', lang: 'hi', lines: ['Khushbu si hai teri baat', 'Mehke mehke din aur raat', 'Phoolon jaisi muskaan hai', 'Gaane mein tera naam hai'] },
  { id: 'lehar-lehar', title: 'Lehar Lehar', lang: 'hi', lines: ['Lehar lehar, paani chamke', 'Kinaare pe dil bhi thirke', 'Sur ki kashti, dhun ka paal', 'Chal chalein hum saath, sambhaal'] },
  { id: 'layi-bhari', title: 'Layi Bhari', lang: 'mr', lines: ['Layi bhari, layi bhari', 'Gaanyachi hi ghaatli sari', 'Mitra mitra, sur dharun', 'Ekmekanna gaato aaj'] },
  { id: 'mitwa-mere', title: 'Mitwa Mere', lang: 'hi', lines: ['Mitwa mere, dil ki dhadkan', 'Sur mein bolo, raat ka aangan', 'Haule haule gaao tum', 'Chaand bhi sun le hum'] },
  { id: 'mehfil-ki-shaam', title: 'Mehfil Ki Shaam', lang: 'hi', lines: ['Mehfil ki yeh shaam hai', 'Har dil mein ek naam hai', 'Ek ek karke gaate jaayein', 'Sab milke jashn manaayein'] },
  { id: 'nadiya-kinare', title: 'Nadiya Kinare', lang: 'hi', lines: ['Nadiya kinare baithe hum', 'Lehron se kehte apna gham', 'Chaand ki chhaon, geet ki dhun', 'Sur mein bahe yeh pal sun'] },
  { id: 'nakhrewali', title: 'Nakhrewali', lang: 'mr', lines: ['Nakhrewali, gaani ga', 'Hasat hasat sur lavun ga', 'Ghari ghari dhun vaaje', 'Mann maajhe nachu laage'] },
  { id: 'oh-re-saathi', title: 'Oh Re Saathi', lang: 'hi', lines: ['Oh re saathi, aao paas', 'Gaane mein hai sabka raas', 'Saath chalein jab raah mile', 'Sur mein sur ki baat khile'] },
  { id: 'ojhal-chandni', title: 'Ojhal Chandni', lang: 'mr', lines: ['Ojhal chandni, ratra gaari', 'Gaanyanchi mehfil bhaari', 'Mann maajhe dhun vaaje', 'Sakhya saath gaato aaje'] },
  { id: 'pyaar-ki-pehli-baat', title: 'Pyaar Ki Pehli Baat', lang: 'hi', lines: ['Pyaar ki pehli baat yaad hai', 'Dhadkan ne jab kuch kaha tha', 'Aankhon se jo bola tha', 'Woh geet ab bhi gaata hoon'] },
  { id: 'pahaad-se-ooncha', title: 'Pahaad Se Ooncha', lang: 'en', lines: ['Higher than the mountain peak', 'Our voices climb and never leak', 'Every note a step ahead', 'Singing up where dreams are fed'] },
  { id: 'raat-suhani', title: 'Raat Suhani', lang: 'hi', lines: ['Raat suhani, chaand khila hai', 'Taare bhi sun ne aaye hain', 'Gaao, gungunao, mat ruko', 'Yeh raat phir kab aayegi'] },
  { id: 'rang-rang', title: 'Rang Rang', lang: 'mr', lines: ['Rang rang, sagle rang', 'Gaanyat bhijle mann sang', 'Lal, nila, hirva, pivla', 'Sur sagla jhala ujla'] },
  { id: 'sangeet-sagar', title: 'Sangeet Sagar', lang: 'hi', lines: ['Sangeet ka sagar gehra hai', 'Har lehar mein ek pehra hai', 'Dubki maaro, mat ghabraao', 'Gaane mein hi tum kho jaao'] },
  { id: 'sur-ki-duniya', title: 'Sur Ki Duniya', lang: 'hi', lines: ['Sur ki duniya sab ki hai', 'Koi bhi ho, koi bhi jaat', 'Gaana sabko jod de', 'Dil se dil ki baat kahe'] },
  { id: 'tera-mera-gaana', title: 'Tera Mera Gaana', lang: 'hi', lines: ['Tera mera gaana ek hai', 'Sur bhi ek, taal bhi ek hai', 'Tum gaao to main bhi gaaun', 'Milke dono ghar mehkaaun'] },
  { id: 'tara-tara', title: 'Tara Tara', lang: 'mr', lines: ['Tara tara, chamkaa re', 'Gaanyat rangun ghar bharaa re', 'Sakhe sobat ye ga ye', 'Gaato majhya saath ye'] },
  { id: 'umeed-ki-kiran', title: 'Umeed Ki Kiran', lang: 'hi', lines: ['Umeed ki kiran jagi hai', 'Andhera ab dur bhagi hai', 'Gaao, aao, sab mil jaao', 'Sur se duniya ko jagaao'] },
  { id: 'udaan', title: 'Udaan', lang: 'en', lines: ['Spread your wings and take the sky', 'Let the music lift you high', 'Every song a brand new flight', 'Sing it loud and hold on tight'] },
  { id: 'vaada-hai', title: 'Vaada Hai', lang: 'hi', lines: ['Vaada hai, saath nibhaayenge', 'Gaate gaate raat bitaayenge', 'Sur mein sur milaa ke rakhna', 'Yeh mehfil kabhi na chhoodna'] },
  { id: 'vaat-pahat', title: 'Vaat Pahat', lang: 'mr', lines: ['Vaat pahat sakhya ki', 'Gaanyachi kaal hi yaadi', 'Ye re ye re paavsa', 'Sur gheun ya majhya saath'] },
  { id: 'waqt-ka-pahiya', title: 'Waqt Ka Pahiya', lang: 'hi', lines: ['Waqt ka pahiya chalta jaaye', 'Gaane wale bhi gaate jaayein', 'Ek sur mein sab saath chalen', 'Raah mein koi na thak jaaye'] },
  { id: 'woh-din', title: 'Woh Din', lang: 'en', lines: ['I remember that bright day', 'When we sang the night away', 'Laughter filled the empty street', 'And the song kept our feet'] },
  { id: 'yaadon-ki-barsaat', title: 'Yaadon Ki Barsaat', lang: 'hi', lines: ['Yaadon ki barsaat aayi', 'Bheegi bheegi yeh purvaai', 'Gaane se phir dil bhar aaya', 'Har boond ne geet sunaaya'] },
  { id: 'yeh-raat', title: 'Yeh Raat', lang: 'hi', lines: ['Yeh raat kabhi na jaaye', 'Gaane mein hi kho jaaye', 'Sitaaron ki mehfil hai', 'Sur ki yeh aashiqui hai'] },
  { id: 'zindagi-ka-sur', title: 'Zindagi Ka Sur', lang: 'hi', lines: ['Zindagi ka sur sunaaye', 'Har dukh mein muskaan jagaaye', 'Gaate raho, chalte raho', 'Sur ke saath ghar banaao'] },
  { id: 'zara-si-muskaan', title: 'Zara Si Muskaan', lang: 'hi', lines: ['Zara si muskaan de do', 'Gaane ko ek jaan de do', 'Dil ki baat sun ke gaao', 'Sab ko apna bana ke jaao'] },
];

// Songs the bots can sing for a letter, not yet sung at this table.
function librarySongsFor(letter, usedTitles = []) {
  const used = new Set(usedTitles.map(s => s.toLowerCase()));
  return LIBRARY.filter(s => s.title[0].toUpperCase() === letter && !used.has(s.title.toLowerCase()));
}

module.exports = { LIBRARY, librarySongsFor };
