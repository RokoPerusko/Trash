# TAK 3D karta (Cesium + OpenTAKServer)

Mali Node.js backend cita podatke iz OpenTAKServer API-ja i prikazuje ih na 3D globusu
(CesiumJS) s terenom (Cesium World Terrain) i zgradama (Cesium OSM Buildings).

```
OpenTAKServer  <--API (JWT)--  backend (server.js)  <--/api/state--  preglednik (Cesium)
```

Lozinka i token ostaju na backendu. Backend po zadanom slusa samo na 127.0.0.1.

## Pokretanje

Potreban je Node.js 20.6 ili noviji (`node --version`). Nema npm paketa za instalaciju.

1. Kopirajte `.env.example` u `.env` i upisite:
   - `OTS_URL` (npr. `https://10.114.207.203`, ZeroTier mora biti spojen),
   - `OTS_USERNAME` / `OTS_PASSWORD` (korisnik s pravom citanja; za pocetak vas korisnik),
   - `CESIUM_ION_TOKEN`: besplatan racun na https://ion.cesium.com -> Access Tokens.
     Bez tokena radi samo ravna karta bez terena i zgrada.
2. `node --env-file=.env server.js` (ili `npm start`)
3. Otvorite http://127.0.0.1:3000

## Samopotpisani certifikat

Najbolje: kopirajte CA certifikat servera na ovo racunalo i postavite
`NODE_EXTRA_CA_CERTS=/putanja/ca.pem`. Za brzu probu na privatnoj mrezi
`OTS_INSECURE=1` iskljucuje provjeru (aplikacija ispise upozorenje).

## Sto je provjereno, a sto nije

Provjereno (na laznom serveru `mock-ots.js`): prijava, citanje vise endpointa,
normalizacija, brisanje nestalih objekata, prikaz u pregledniku, pogresna lozinka,
nedostupan server.

NIJE provjereno protiv pravog OpenTAKServera. Dokumentacija ne navodi:
- tocan oblik zahtjeva za `/oauth/token` -> backend isprobava 4 varijante prijave
  (JSON, form, query, `/api/login`) i u logu ispise koja je uspjela;
- oblik odgovora `/api/map_state`, `/api/eud`, `/api/markers` -> backend trazi bilo koji
  objekt s `lat`/`lon` (ili ugnijezdenim `point`), pa ce vjerojatno raditi, ali ne jamcim.

Ako je karta prazna: otvorite http://127.0.0.1:3000/api/debug (sirovi odgovori i nacin prijave)
i posaljite mi taj ispis (bez lozinki), pa prilagodimo `OTS_ENDPOINTS` ili normalizaciju.
Takodjer nije provjereno ucitavanje terena i zgrada (treba pravi Cesium ion token i internet).

## Ponasanje na karti

- Zracni objekti (CoT tip `a-?-A...`) crtaju se na stvarnoj visini (`hae`), ostali na tlu.
- Boje po tipu: `a-f` plavo (prijatelj), `a-h` crveno, `a-n` zeleno, `a-u` zuto.
- Objekti s koordinatama 0,0 (iTAK "NO GPS") preskacu se.
- Objekt koji nestane iz API-ja nestane i s karte (osvjezavanje svake `POLL_MS` ms).

## Licence i uvjeti

Cesium World Terrain i OSM Buildings dolaze preko Cesium iona; obavezna atribucija
"(c) OpenStreetMap contributors" prikazuje se automatski. Offline uporaba tih podataka nije
provjerena: procitajte Cesium ion uvjete prije oslanjanja na nju.
