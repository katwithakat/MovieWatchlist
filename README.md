# CineList — Movie Watchlist

A personal movie watchlist web app. Search movies via OMDb, keep a curated
collection, browse featured picks, and play trailers inside the app.

## Features

- **OMDb search** — look up a title, preview its poster/genre/rating, then add it.
- **Validated adds** — the manual add form verifies title, year, and genre against
  OMDb before saving, so entries always hold official data.
- **Featured carousel** — a curated homepage list, loaded independently of your watchlist.
- **Trailer theatre** — `▶ Play all trailers` plays every watchlist trailer in turn,
  auto-advancing when one ends, with Previous / Next controls.
- **Details view** — shows the full OMDb profile plus an inline YouTube trailer.
- **Filters & stats** — filter by title, status, genre, and sort; totals, average
  rating, watched, and favorites are shown live.
- **Dark / light theme** — remembered per browser.

## Requirements

- Node.js 18+
- An [OMDb API key](https://www.omdbapi.com/apikey.aspx)

## Setup

```powershell
npm install
```

Create a `.env` file in the project root:

```
OMDB_API_KEY=your_omdb_key_here
PORT=3000
```

`TMDB_API_KEY` is optional — when present it is used first for trailer lookups,
with YouTube search as the fallback.

## Run

```powershell
npm start
```

Then open <http://localhost:3000>.

## Project layout

```
server.js          Express server + API routes (movies, featured, trailer, OMDb)
db.js              JSON-file storage for the watchlist and featured list
public/
  index.html       App shell (search, featured carousel, watchlist, dialogs)
  script.js        Client logic (rendering, trailers, theme, confirm dialog)
  style.css        Styling for dark and light themes
movies.json        Watchlist data (created on first run, git-ignored)
featured.json      Featured cache (created on first run, git-ignored)
```

## API

| Method | Route                | Purpose                              |
| ------ | -------------------- | ------------------------------------ |
| GET    | `/api/movies`        | List the watchlist                   |
| POST   | `/api/movies`        | Add a movie                         |
| PUT    | `/api/movies/:id`    | Update watched / favorite / fields   |
| DELETE | `/api/movies/:id`    | Remove a movie                      |
| GET    | `/api/lookup`        | OMDb title search                    |
| POST   | `/api/validate`      | Verify title / year / genre via OMDb |
| GET    | `/api/featured`      | Curated homepage picks               |
| GET    | `/api/movie/:imdbID` | Full OMDb detail for one movie       |
| GET    | `/api/trailer`       | Resolve a YouTube trailer id         |
