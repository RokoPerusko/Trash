# TAK 3D karta (Cesium + OpenTAKServer)

Node backend čita OpenTAKServer (OTS) API i prikazuje uređaje i markere na CesiumJS 3D
karti (teren + zgrade). Pokretanje: `node --env-file=.env server.js` (Node >= 20.6).
Zgrade i teren su OSM Buildings / Cesium World Terrain preko Cesium ion-a (atribucija
vidljiva na dnu karte u Cesium kredencijalima).

## Datoteke
- `server.js` — ulazna točka (~40 linija): provjere postavki, učitavanje podataka, pokretanje.
  Sva logika je u `server/`, podijeljena po temi (bez npm paketa). Tok jednog zahtjeva:
  `app.js` provjeri host i sesiju, pa ga proslijedi pravom modulu u `api/`.
  - `config.js` — sve postavke iz `.env` na jednom mjestu.
  - `http.js` — JSON odgovori, sigurnosna zaglavlja, čitanje tijela zahtjeva.
  - `login.js`, `api/session.js` — prijava prema OTS-u, sesije, `/api/login|logout|session|health`.
  - `ots.js` — prijavljeni OTS klijent; `normalize.js` pretvara odgovore u objekte s položajem.
  - `devices.js` — uređaji (`/api/eud` + položaj iz `/api/cot`); `history.js` — povijest položaja.
  - `state.js` — petlja koja periodično čita OTS i gradi stanje karte (`/api/state`).
  - `alerts.js` — alarmi (zone, baterija, ne javlja) i alarmi iz OTS-a.
  - `data.js` — zone, rute i zapisnik (`data/*.json`, `data/audit.log`).
  - `api/markers.js` (`POST /api/upsert-marker`, `/api/delete-marker`), `api/zones.js`,
    `api/routes.js`, `api/info.js` (`/api/state`, `/config`, `/api/history`, `/api/alerts`,
    `/api/debug`), `static.js` (datoteke iz `public/`).
  Sve rute koje mijenjaju stanje traže zaglavlje `X-TAK-App: 1`.
- `ots-client.js` — OTS klijent (prijava, CSRF, ponovna prijava na 401/403/CSRF,
  praćenje razlike sata prema OTS serveru).
- `lib/json-store.js` (atomarna pohrana zona i ruta), `lib/validate.js` (validacija unosa),
  `lib/auth.js` (sesije, ograničenje pokušaja), `lib/audit.js` (zapisnik promjena).
- `mock-ots.js` — lažni OTS na `127.0.0.1:8099` za testiranje bez pravog servera.
- `ots-call.mjs` — CLI za ručno testiranje OTS API-ja.
- `public/index.html` — ljuska sučelja (navbar, bočna traka, kartica detalja, dijalog).
- `public/css/app.css` — stilovi, tamna i svijetla tema, mobilni raspored.
- `public/js/` — ES moduli bez build koraka: `main.js` (ulaz), `map.js` (Cesium, podloge,
  uzorkovanje terena), `modes.js` (alati na karti), `nav.js`, `items.js`, `history.js`,
  `markers.js`, `measure.js`, `zones.js`, `routes.js`, `alerts.js`, `profile.js`,
  `dialog.js`, `util.js`, te čisti moduli koje dijele backend i sučelje i koji se testiraju:
  `geo.js` (udaljenosti, azimut, uzorkovanje rute), `gpx.js`, `kinds.js` (vrste objekata).
- `test/` — testovi (`npm test`, ugrađeni `node:test`), `scripts/ui-check.mjs` — dimni test
  sučelja u headless pregledniku.
- `data/zones.json`, `data/routes.json` — spremljene zone i rute (u `.gitignore`, stvaraju se
  automatski).

Naredbe: `npm start`, `npm run mock`, `npm run check` (sintaksa), `npm test`,
`npm run format` / `npm run format:check`, `npm run ui-check` (treba pokrenut server).

## Prijava
- Korisnici se **provjeravaju prema OTS-u** (isti računi): server pokuša prijavu na OTS s
  unesenim podacima i traži da `/api/me` vrati profil. Lozinka se nigdje ne sprema ni logira.
- **Kad je obavezna:** zadano čim `HOST` nije loopback (npr. `0.0.0.0`); lokalno na
  `127.0.0.1` je isključena osim s `AUTH_REQUIRED=1`. Ako je sučelje dostupno s mreže, a prijava
  isključena (`AUTH_REQUIRED=0`), server **odbija pokretanje** osim uz `AUTH_ALLOW_OPEN=1`.
- Sve osim same stranice (`/`, `css`, `js`) traži sesiju: `/api/*` i `/config` (u kojem je ion
  token) vraćaju 401 bez nje. Bez prijave su samo `/api/health`, `/api/session`, `/api/login`.
- Sesija je nasumičan token (32 B) u `HttpOnly`, `SameSite=Strict` kolačiću (`Secure` uz
  `COOKIE_SECURE=1` ili `TRUST_PROXY=1` i HTTPS), čuva se u memoriji pod hashom, traje
  `AUTH_SESSION_HOURS` (12) i nestaje pri restartu servera. Zahtjevi koji mijenjaju stanje i dalje
  traže `X-TAK-App: 1` (zaštita od CSRF-a uz `SameSite`).
- **Ograničenje pokušaja** (15 min): 5 neuspjeha po korisničkom imenu i 10 po IP adresi, zatim 429;
  svaki neuspjeh dodatno čeka 0,4 s. Posljedica: netko može namjerno zaključati tuđe korisničko
  ime na 15 min (kompromis protiv pogađanja lozinke). Iza proxyja koristi `TRUST_PROXY=1`, inače
  su svi klijenti za server jedna IP adresa.
- Svi prijavljeni korisnici imaju jednaka prava (uloge iz OTS-a se samo čitaju). Ako treba
  razlikovati promatrača od operatera, to je sljedeći korak.
- Sučelje: forma prijave prije učitavanja karte, korisnik i "Odjava" u izborniku; istekla sesija
  automatski vraća na prijavu.

## Sučelje (navbar, bočna traka, mobitel)
- **Navbar**: naziv, status veze, glavni izbornik (Objekti, Rute, Zone, Alarmi s brojačem),
  alati na karti (marker, mjerenje, zona, ruta, prikaži sve) i izbornik s postavkama (tema,
  podloga, zvuk alarma, prikaz isteklih markera, debug).
- **Mobitel** (< 800 px): glavni izbornik postaje donja traka, alati plutajući stupac, a bočna
  traka i kartica detalja donji listovi. Otvaranje detalja zatvara bočnu traku.
- Alat na karti je aktivan najviše jedan odjednom (`modes.js`); `Esc` ga prekida, a uputa i
  radnje (Završi, Poništi, Odustani) su u traci na vrhu karte.
- Umjesto `prompt/confirm/alert` koriste se dijalozi i obavijesti iste teme.
- Tema (tamna/svijetla), podloga (satelit, ceste, OSM; satelit i ceste traže ion token) i
  zvuk alarma pamte se u pregledniku. Klik na zonu ili rutu na karti otvara je u bočnoj traci;
  brisanje zone ide iz popisa (ne klikom na kartu, da se ne briše slučajno).

## Rute
- **OTS nema API za planirane rute** (provjereno u izvorniku, `ots_api/`: markeri, misije,
  casevac, grupe, video... ali ne rute; `rb_lines` su linije azimut/udaljenost). Zato se rute
  čuvaju na našem backendu u `data/routes.json` i dijele među korisnicima, kao zone.
- Alat Ruta: klik za točke, "Poništi zadnju", "Završi" ili dvoklik, zatim naziv. API:
  `GET/POST /api/routes`, `PUT/DELETE /api/routes?id=` (≥ 2 i ≤ 200 točaka, brzina 0.1–2000 km/h).
- Detalji rute: duljina, vrijeme pri zadanoj brzini (pješice 5, bicikl 15, vozilo 50, dron 40
  km/h ili vlastita), uspon/spust i najniža/najviša točka, visinski profil i tablica dionica
  (duljina, azimut, ukupno). Akcije: približi, preimenuj, obrni smjer, izvoz **GPX**, obriši.
- Visinski profil koristi `sampleTerrainMostDetailed` (teren najveće razlučivosti gdje god bila
  kamera), pa traži `CESIUM_ION_TOKEN`; bez njega se profil ne prikazuje (a ne lažni profil).
  Mjerenje vidljivosti koristi isti način uzorkovanja.

## Vrste objekata i dronovi
- `public/js/kinds.js` je jedino mjesto gdje se definira vrsta objekta (`marker`, `device`,
  `uav`): naziv, oblik ikone, smije li se uređivati, ima li povijest. Novu vrstu dodaje se kao
  jedan unos u `KINDS` i jedno pravilo u `RULES`; popis, filteri (čipovi se grade iz vrsta koje
  postoje), ikone, kartica detalja i backend (`item.kind`) preuzimaju je sami.
- Dron se prepoznaje po CoT tipu `a-?-A-M-?-Q` (npr. `a-f-A-M-F-Q`, `a-f-A-M-H-Q`) i prikazuje
  kao strelica okrenuta prema smjeru kretanja; marker iz `/api/markers` je uvijek marker.
- Svaki uređaj nosi `telemetry` `{ speed (m/s), course (°), battery (%) }` iz zadnje CoT točke.
  Kartica prikazuje brzinu u km/h, smjer, a za zračne objekte i **visinu nad tlom**
  (visina − teren, treba ion token). Alarm "niska baterija" (`OTS_LOW_BATTERY_PCT`, zadano 20)
  vrijedi za svaku vrstu koja javlja bateriju.
- U mock OTS namjerno **nije** dodan dron; kad ga bude, treba ga dodati u `mock-ots.js` s
  tipom `a-f-A-M-F-Q`, putanjom i padom baterije.

## OTS API-ji koje koristimo
`/api/eud`, `/api/cot` (položaji i povijest), `/api/markers` (GET/POST/DELETE),
`/api/map_state` (po želji preko `OTS_ENDPOINTS`) i novo `GET /api/alerts` — stvarni alarmi s TAK
klijenata (polje `alert_type`, `start_time`, `cancel_time`, `point`, `callsign`). Čitaju se svakih
`OTS_ALERTS_EVERY_MS` (10 s), zadnja stranica daje najnovije, prikazuju se u Alarmima s oznakom
aktivan/poništen, uz obavijest za nove; `OTS_ALERTS_PATH=` (prazno) ih isključuje. Poznate
oznake: `b-a-o-tbl` (911), `b-a-o-pan` (ring the bell), `b-a-o-opn` (troops in contact),
`b-a-o-can` (poništeno) — ostale se prikazuju sirove. OTS nudi još `/api/video_streams`,
`/api/casevac`, `/api/eud_stats`, `/api/status`, `/api/missions`, `/api/groups`; nisu potrebni
pa nisu spojeni (video tokovi dronova su prirodan sljedeći korak).

## Zamke OTS-a koje utječu na prikaz (otkriveno u izvornom kodu)
- **OTS vraća samo 10 zapisa po stranici** (`paginate()`, zadano `per_page=10`, redoslijed
  od najstarijeg). Prije je aplikacija čitala samo prvu stranicu `/api/markers`, pa se
  najnoviji markeri (npr. oni postavljeni s mobitela) nisu vidjeli čim ih je bilo više od 10.
  Sad se traži `per_page=100` i čitaju se sve stranice (do `OTS_MAX_PAGES`, zadano 20); u banneru
  se javlja ako je popis ipak prekinut. `/api/map_state` nije straničen.
- **Marker iz aplikacije ne vide TAK klijenti ako je sat OTS-a pogrešan.** `POST /api/markers`
  stvara CoT s `time=OTS_sada` i `stale=OTS_sada+24 h` i šalje ga klijentima. Ako OTS kasni više
  od 24 h, `stale` je već u prošlosti pa ga iTAK/ATAK odbacuju kao istekli. Naš payload ne može
  promijeniti ta polja; jedino rješenje je uskladiti sat OTS računala (NTP). Aplikacija sad
  upozorava u banneru kad se sat OTS-a razlikuje više od 5 min (`clockSkewMs` u `/api/state`).
- **OTS ne briše uređaje.** Kad se isti telefon ponovno prijavi s novim `uid`-om, stari zapis
  ostaje u `/api/eud`. Uređaji koji su odspojeni i ne javljaju dulje od `OTS_OFFLINE_HIDE_HOURS`
  (zadano 24) skrivaju se s karte i iz popisa; u izborniku je prekidač "Prikaži odspojene
  uređaje". Za njih se ne javlja ni alarm "ne javlja položaj".

## Povijest i reprodukcija (zadatak 1)
- `GET /api/history?uid=<uid>&from=<ISO>&to=<ISO>` — vraća CoT pozicije uređaja u
  rasponu (ako `from`/`to` nisu zadani: cijela dostupna povijest, do
  `OTS_HISTORY_MAX_PAGES` stranica). Pretraga stranice `/api/cot` je binarna po
  vremenu prvog zapisa (jer je povijest dodavana kronološki), pa se za uzak raspon
  dohvati samo nekoliko stranica umjesto svih. Stranice osim zadnje su trajno
  nepromjenjive (append-only povijest) pa se trajno keširaju u memoriji; zadnja
  stranica (koja se još može mijenjati) se uvijek dohvaća iznova.
- U sučelju: gumb **Povijest** u kartici uređaja (samo za uređaje, ne markere) učita
  trag po terenu (plava polilinija) i otvori traku na dnu s klizačem vremena,
  play/pause i brzinom 1x/10x/60x. Kartica tijekom reprodukcije prikazuje brzinu,
  smjer i bateriju iz te povijesne točke. Gumb **Uživo** vraća uređaj na uživo
  praćenje.
- Rubni slučajevi: zapisi s lat/lon≈0 ("nema GPS-a") se izbacuju iz valjanih točaka i
  ne koriste se za trag/reprodukciju; ako nema niti jedne valjane točke, gumb javlja
  grešku i ne otvara povijest. Duplikati (isti timestamp+lat+lon) se uklanjaju na
  backendu. Praznine u signalu dulje od 5 min prekidaju trag (nema linije preko
  praznine) i reprodukcija to prikazuje kao "nema signala" uz zadnju poznatu poziciju.

## Markeri: stvaranje, premještanje, preimenovanje (zadatak 2a)
- Istraženo u OTS izvornom kodu (`opentakserver/blueprints/ots_api/marker_api.py`) i
  potvrđeno uživo čitanjem `/api/markers` na pravom serveru: OTS **nema** zaseban
  PUT/PATCH za marker. `POST /api/markers` stvara novi marker ako `uid` još ne
  postoji, a **ponovni POST s istim `uid`** ažurira postojeći (nova `latitude`/
  `longitude` = premještanje, novi `name` = preimenovanje — isti mehanizam za oba).
  Bitno: `type` se ne pamti između poziva — ako se izostavi na ažuriranju, OTS ga
  tiho resetira na `a-u-G` (gubi se afilijacija/ikona), pa backend uvijek šalje
  postojeći `type` kad `uid` već postoji.
- `uid` mora biti u UUID formatu (32 hex znamenke s crticama); markeri koje je
  stvorio neki drugi TAK klijent s drugačijim uid-om (npr. SPI točke s nastavkom
  `.SPI1`) se zato ne mogu premještati/preimenovati preko ovog API-ja — to je
  ograničenje OTS-a, ne ove aplikacije.
- Backend: `POST /api/upsert-marker` (zaglavlje `X-TAK-App: 1`) prima
  `{ uid?, lat, lon, name, type? }`; bez `uid` generira novi (`crypto.randomUUID`),
  s `uid` dohvaća postojeći `type` iz trenutnog stanja ako nije zadan.
- Sučelje: gumb ✛ u zaglavlju panela uključuje "stvaranje" način rada — klik na
  kartu (ne na postojeći entitet) traži naziv i stvara marker tamo. Markeri
  (ne uređaji) se mogu povući mišem po karti za premještanje. Gumb **Preimenuj**
  u kartici markera traži novi naziv.
- OTS svakom markeru stvorenom preko `POST /api/markers` tvrdo postavlja `stale` na
  točno 24 h od trenutka kad OTS **svojim vlastitim satom** misli da je "sada" (vidi
  `timedelta(days=1)` u izvorniku) — to se ne može promijeniti kroz naš payload.
  Nakon isteka marker se zadano skriva (kao i svi istekli markeri; postojeći
  checkbox "Prikaži istekle markere" ga vraća). Kartica markera i njegova točka na
  popisu zato pokazuju žuto upozorenje kad je ostalo manje od 2 h do isteka
  ("uskoro istječe za X min/h").
- **Pravi uzrok zašto novi markeri nisu bili vidljivi na karti (otkriveno uživo):**
  sat OTS virtualne mašine kasni za stvarnim vremenom ~29 h (potvrđeno HTTP `Date`
  zaglavljem servera: `curl -skI https://OTS/api/markers` vs stvarno vrijeme). Kad
  OTS stvori marker, zapisuje `stale = (svoje pogrešno "sada") + 24 h` — a kako je
  OTS-ov sat već >24 h iza stvarnog vremena, taj `stale` je **već prošao u trenutku
  stvaranja** gledano iz stvarnog vremena. Marker se zato odmah tretirao kao istekao
  i nestajao s karte, bez obzira koliko puta ga korisnik stvorio.
  - **Popravljeno u `ots-client.js`**: svaki odgovor OTS-a nosi HTTP `Date`
    zaglavlje; iz njega se računa razlika sata (`clockSkewMs`) i izlaže kao
    `ots.clockSkewMs`.
  - **`server.js`** (`fixServerTime()` u `asItem()`) tom razlikom korigira polja
    `time`/`stale` koja je generirao sam OTS server (markeri) prije nego dođu u
    `/api/state` — uređaji nisu pogođeni jer njihov polažaj/vrijeme dolazi s
    uređaja (GPS/CoT), ne sa sata OTS servera, i već je bio ispravan.
  - Ovo je zakrpa na našoj strani; stvarni popravak je uskladiti sat OTS VM-a
    (NTP). Dok se to ne napravi, aplikacija i dalje radi ispravno, ali svi apsolutni
    "server-generirani" timestampovi koje OTS vrati (npr. `production_time` u sirovim
    podacima pod "Sva polja iz API-ja") ostaju prikazani neispravljeni.

## Mjerenje: udaljenost, visinski profil, vidljivost (zadatak 2b)
- Čisto frontend — Cesium već ima učitan teren (World Terrain preko ion tokena), pa
  nije trebao backend. Gumb 📏 u zaglavlju panela uključuje način rada: klik na dvije
  točke na karti (ne na postojeći entitet) mjeri segment između njih.
- Udaljenost po tlu je geodetska (`Cesium.EllipsoidGeodesic`), ne ravna linija.
  Vidljivost: uzorkuje teren (`scene.sampleHeight`) u 48 točaka između A i B, povuče
  ravnu "liniju vidljivosti" na visini tla+1,6 m (visina oka) na oba kraja, i gleda
  presijeca li teren tu liniju igdje između — ako da, prepreka je prva takva točka
  (crvena kuglica na karti), linija cijela postane crvena; ako ne, cijela je zelena.
- Rezultat se prikazuje u panelu desno dolje: udaljenosti (po tlu/zrakom), status
  vidljivosti (zelena/crvena oznaka s tekstom, ne samo boja) i mali SVG visinski
  profil (sivi = teren, zeleno/crveno = linija vidljivosti, crvena točka = prepreka)
  s crosshair/tooltipom na hover (udaljenost + visina terena na toj točki).
- Bez `CESIUM_ION_TOKEN` (ravna karta, bez terena) `sampleHeight` nema s čega
  očitati visinu — profil je ravan na 0 m i "vidljivost" je uvijek slobodna; to je
  ograničenje nedostatka terena, ne greška.

## Zone i alarmi (zadatak 2c)
- Gumb ⬡ u zaglavlju: odabir **Poligon** (klikovi po karti, dvoklik zatvara, min. 3
  točke) ili **Krug** (klik centra, klik za radijus), zatim upit za naziv i
  `POST /api/zones`. Zone se trajno spremaju u `data/zones.json` (u `.gitignore`).
  Zona se briše iz popisa Zone (ikona koša, uz potvrdu; `DELETE /api/zones?id=`).
- Backend na svakom ciklusu dohvata (`refresh()`, isti kao za `/api/state`)
  provjerava je li svaki uređaj unutar/izvan svake zone (krug: Haversine udaljenost
  do centra; poligon: ray-casting) i uspoređuje s prethodnim stanjem po uređaju —
  alarm **enter/exit** se javlja samo na promjenu, ne svaki ciklus. Ako se zona
  obriše dok je uređaj unutra, to se tiho makne iz stanja uređaja bez lažnog "exit"
  alarma (zona više ne postoji).
- "Uređaj ne javlja X min" (`OTS_NO_REPORT_MIN`, zadano 10): pratimo zadnje vrijeme
  javljanja po uređaju; kad prođe prag, alarm se javi **jednom** (ne ponavlja se dok
  uređaj opet ne javi položaj, što resetira zastavicu).
- Alarmi se drže u memoriji (zadnjih 500, najnoviji prvi; gube se na restart servera
  — namjerno, bez dodatne trajnosti/ovisnosti). Sučelje ih dohvaća preko
  `GET /api/alerts` i prikazuje u panelu dolje lijevo (boja točke: zeleno=ulaz,
  žuto=izlaz, crveno=nema javljanja).
- **OTS nema vlastiti pojam zone/geofencinga** (provjereno u izvorniku: modeli su
  `Marker`, `Point`, `RBLine` - linija za azimut/udaljenost, i `Alert` - ali to je
  za hitne/911 CoT signale s TAK klijenta, npr. `b-a-o-tbl`, ne za geofencing). Zato
  zone i enter/exit/no-report logika moraju biti naše, nema gotovog OTS API-ja za
  to - `data/zones.json` + backend provjera je ispravan pristup, ne izmišljanje
  kotača.
- **Popravljen bug: nacrtana zona se nije vidjela, samo natpis s imenom.** Poligon i
  krug su crtani s `height: 0` (0 m iznad WGS84 elipsoida/razine mora), a ne na
  stvarnoj visini terena; uz učitan teren i `depthTestAgainstTerrain`, teren je bio
  ispred/iznad te plohe pa je ispod tla - nevidljivo, dok se natpis (koji je već
  imao `heightReference: CLAMP_TO_GROUND`) i dalje vidio. Popravljeno postavljanjem
  `heightReference: CLAMP_TO_GROUND` i na poligon i na krug (sad se stvarno
  "lijepe" na teren, ne na razinu mora). Napomena: Cesium-ova obrub linija (outline)
  na terenu-prilijepljenim oblicima ima povijesno slabiju GPU podršku - ako se ispuna
  zone vidi a obrub ne, to je poznato ograničenje, ne nova greška.

## Provjereno
- **Novo sučelje (navbar, rute, alarmi, markeri, mjerenje, povijest, zone, tema, mobitel)**
  provjereno u headless Braveu s pravim Cesium ion tokenom prema `mock-ots.js` (ne prema pravom
  OTS-u): stvaranje rute s visinskim profilom, zona, marker preko sučelja, mjerenje, povijest,
  tamna/svijetla tema, razmještaj na 1400 px i 390 px, konzola bez grešaka. Nije provjereno na
  pravom dodiru (touch), pravom OTS-u s TLS-om, povlačenje markera mišem, reprodukcija povijesti
  tijekom igranja i zvuk alarma. Napomena: iz povijesti ove datoteke niže, tvrdnje "nije
  testirano u pravom pretraživaču" vrijede za stari kod prije ove izmjene.
- `/api/history` testiran na `mock-ots.js` (proširen s 250 povijesnih CoT zapisa za
  `DEV-1`, uključujući 41 zapis bez GPS-a i 5 marker-tipa zapisa koji se ispravno
  izbacuju): binarna pretraga stranica, filtriranje po `uid`/`from`/`to`, deduplikacija
  i keširanje rade kako treba (uzak raspon = 1 skenirana stranica umjesto 3).
- `/api/upsert-marker` i proširen `mock-ots.js` testirani cijelim krugom: stvaranje
  (novi uid, ispravan odgovor), premještanje (isti uid, nove koordinate), preimenovanje
  (isti uid, novo ime, provjereno da se tip/afilijacija ne gubi), brisanje, te greške
  za nepostojeći uid i neispravan uid format — svi odgovori odgovarali očekivanom.
  Usput otkriven i popravljen bug: `asItem()` u `server.js` nije filtrirao OTS-ov
  "nepoznato" senzor `hae/ce/le=9999999`, pa bi novi marker bez visine prikazivao
  "9999999 m" u kartici (sada se, kao i za uređaje, tretira kao nepoznato).
- Stvaranje markera (gumb ✛) potvrđeno uživo na pravom OTS-u (korisnik je stvorio 3
  testna markera preko sučelja; `GET /api/markers` ih vraća s točnim koordinatama i
  nazivom), ali se odmah nisu vidjela na karti — to je dovelo do otkrića razlike sata
  opisane gore. Nakon popravke (`clockSkewMs`), potvrđeno izravnim pozivom na pravi
  OTS da novostvoreni marker dobiva `stale` ispravno ~24 h u budućnosti (prije
  popravke `stale` je bio već prošao u trenutku stvaranja). Testni marker je zatim
  obrisan preko `/api/delete-marker`.
- Tri ranija testna markera korisnika (`marker test`, `marker trst`, `marker`) su i
  dalje na serveru, sad trajno "istekli" (stvoreni su prije popravke) - treba ih
  izbrisati preko sučelja (odaberi marker, uključi "Prikaži istekle markere", pa
  Obriši) ili javiti da ih izbrišem ja.
- Premještanje (povlačenje), preimenovanje i brisanje preko sučelja na pravom OTS-u
  još nisu potvrđeni uživo od korisnika.
- Sučelje (gumb Povijest/traka za reprodukciju, ✛ za stvaranje, povlačenje markera,
  Preimenuj, upozorenje o isteku) nije testirano u pravom pretraživaču s moje strane
  (nema dostupnog alata za automatizaciju preglednika u ovoj sesiji) — JS je
  provjeren samo sintaktički (`node --check`).

- `/api/zones` (GET/POST/DELETE) i enter/exit alarmi testirani na `mock-ots.js`:
  stvaranje kružne i poligonske zone, `GET` vraća obje, uređaj unutar kruga generira
  **jedan** "enter" alarm (ne ponavlja se na sljedećim ciklusima), zona daleko od
  uređaja ne generira lažni alarm, brisanje zone (i brisanje nepostojeće → 404),
  validacija (nedostaje radijus → 400), i brisanje zone dok je uređaj unutra ne
  generira lažan "exit". `data/zones.json` se ispravno sprema/učitava.
- "Ne javlja X min" alarm je **logički pregledan, ali nije uživo testiran** — mock
  uvijek vraća uređaju svjež `last_event_time` (trenutno vrijeme) na svaki poziv, pa
  se u mocku ne može simulirati "tišina". Prije nego se ovo smatra potvrđenim,
  trebalo bi stvarno ugasiti/odspojiti uređaj na pravom OTS-u i pričekati
  `OTS_NO_REPORT_MIN` (zadano 10 min).
- Mjerenje/vidljivost (gumb 📏) i zone (gumb ⬡, crtanje, brisanje klikom) nisu
  testirani u pravom pretraživaču s moje strane (nema dostupnog alata za
  automatizaciju preglednika u ovoj sesiji) — samo sintaktički (`node --check`).
  `Scene.sampleHeight` zahtijeva da je teren stvarno učitan (ion token + okolina
  oko klika mora biti u vidnom polju); vrijedi isprobati i izbliza i izdaleka.

## Neprovjereno
- Podržava li `/api/cot` sortiranje/filtriranje na API strani (trenutno se filtrira
  na backendu nakon dohvata stranice).

## Sigurnosni nalaz (nevezano za zadatke, otkriveno usput)
`.env` sa stvarnom OTS lozinkom i Cesium ion tokenom bio je commitan i pushan na
javni GitHub repozitorij (`github.com/RokoPerusko/Trash`), jer je datoteka za
ignoriranje bila nazvana `gitignore` umjesto `.gitignore` (git ju nikad nije
primjenjivao). Popravljeno: datoteka preimenovana u `.gitignore` (dodan i `data/`),
`.env` uklonjen iz praćenja (`git rm --cached`) — **ali ostaje vidljiv u staroj git
povijesti dok se ne rotiraju kredencijali**. Potrebno što prije: promijeniti OTS
`administrator` lozinku i povući/zamijeniti Cesium ion token na cesium.com/ion.

## Pravila
- Bez novih npm ovisnosti; frontend je jedan HTML, Cesium 1.120.0 s CDN-a.
- Tajne (lozinka, Cesium token) nikad u kod/log/preglednik; `.env` nije u git-u.
- Sav kod mora biti formatiran: `npm run format` (Prettier preko `npx`, nije ovisnost projekta),
  provjera `npm run format:check`; sintaksa `npm run check`. Konfiguracija u `.prettierrc.json`.
- Sučelje se provjerava u pravom pregledniku (`npm run ui-check`, headless Brave/Chrome); u
  headless načinu natpisi na karti imaju zrnastu pozadinu - to je artefakt SwiftShadera, ne greška.
- Svaka izmjena ide uz sigurnosni pregled: korisnički unos se validira i ograničava, rute koje
  mijenjaju stanje traže `X-TAK-App: 1`, nema `innerHTML` s podacima (samo `textContent`).

## Oblak: HTTPS, kopije, zapisnik, uloge

- **HTTPS:** `docker-compose.yml` pokreće Caddy ispred aplikacije. Lokalno: `HTTP_PORT=8080 HTTPS_PORT=8444 docker compose up -d --build`, pa https://localhost:8444. Na VM-u postavi `SITE_ADDRESS=tvoja.domena` (i dodaj je u `ALLOWED_HOSTS`); portovi 80 i 443 moraju biti slobodni i otvoreni.
- **Kopije:** `scripts/backup.sh` sprema volumen `tak-data` (zone, rute, zapisnik) u `backups/` i čuva zadnjih 14 (`KEEP=30` mijenja broj). Za dnevno pokretanje: `0 3 * * * cd /putanja/do/projekta && ./scripts/backup.sh`. Kopije treba povremeno prebaciti i izvan VM-a.
- **Ažuriranje:** `scripts/update.sh` ponovno gradi sliku s novim Node/Caddy zakrpama, skenira je (Trivy, HIGH/CRITICAL) i ponovno pokreće. Pokretati barem mjesečno.
- **Zapisnik:** `data/audit.log` (JSON, jedna linija po događaju, rotira se na 5 MB, ostaje `audit.log.1`). Bilježi prijave (i neuspjele), odjave te dodavanje/izmjene/brisanje markera, zona i ruta, s korisnikom i IP adresom.
- **Uloge:** `AUTH_EDIT_ROLES` (OTS uloge odvojene zarezom). Prazno = svi prijavljeni mijenjaju. Postavljeno = mijenjaju samo korisnici s tom ulogom, ostali imaju pregled. Provjera je na serveru (HTTP 403), sučelje samo skriva alate.

## Sigurnosne mjere
- TLS provjera se može isključiti (`OTS_INSECURE=1`) samo za OTS klijent, ne za cijeli proces;
  zadano je uključena. OTS klijent koristi `node:http(s)`: bez praćenja preusmjeravanja (tokeni
  ne odlaze na drugi host), s vremenskim ograničenjem i ograničenjem veličine odgovora.
- Lozinka se više nikad ne šalje u URL-u (uklonjen `/oauth/token?username=&password=` pokušaj).
- Provjera `Host` zaglavlja (`ALLOWED_HOSTS`) protiv DNS rebindinga; poslužitelj sluša samo na
  `127.0.0.1`, a za drugi `HOST` ispisuje upozorenje (sučelje nema prijavu).
- `POST/DELETE /api/zones` sada traže `X-TAK-App: 1` (prije nisu, pa je druga stranica mogla
  stvarati zone). Ograničenja: ime ≤ 100 znakova, ≤ 200 zona, ≤ 500 točaka, raspon koordinata
  i radijusa, tip markera po uzorku.
- Zaglavlja: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, CORP i
  ograničen CSP (`frame-ancestors`, `base-uri`, `object-src`, `form-action`). Strožiji
  `script-src`/`connect-src` isprobani su u pregledniku i **ruše satelitsku podlogu**: Cesium ion
  je učitava preko Bing Mapsa JSONP-om (`dev.virtualearth.net`) i dohvaća pločice preko `http://`,
  pa bi trebalo dopustiti i `http:`. Zato je CSP namjerno blag (sučelje inače više nema inline
  skripti, pa je strožiji CSP moguć ako se podloga ograniči na OSM).
- Cesium s CDN-a ima SRI (`integrity`) za `Cesium.js` i `widgets.css`; ostale Cesium datoteke
  (radnici, resursi) učitavaju se bez SRI-ja. `npm audit` za `cesium@1.120.0`: 0 ranjivosti.
- Greške 500 klijentu vraćaju generičku poruku, detalji idu samo u log; zone se spremaju
  atomarno (privremena datoteka + `rename`); dotfile putanje u `public/` su zabranjene.
- Poznato i ostavljeno: `/config` šalje Cesium ion token pregledniku (token je po dizajnu
  javan; ograničite ga na URL u ion nadzornoj ploči). `.env` je i dalje u staroj git povijesti
  - kredencijale treba rotirati.
