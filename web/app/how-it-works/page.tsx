import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import SunlightSketch from "@/components/SunlightSketch";
import { BackIcon, Mark } from "@/components/ui/Icons";
import ValidationScatter from "@/components/ValidationScatter";
import validation from "@/public/data/validation.json";
import points from "@/public/data/validation_points.json";

export const metadata: Metadata = {
  title: "How it works · Lunar Landing Site Navigator",
  description: "How the Lunar Landing Site Navigator works out sunlight and Earth contact on the Moon, and how we checked it against NASA.",
};

// Survey scale: 512 x 512 squares, up to 360 moments, two lines of sight (Sun, Earth) each.
const SURVEY_SIGHTLINES = 512 * 512 * 360 * 2;

const ill = validation.illumination;

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="border-b border-line pb-2 text-[20px] text-ink">
        <span className="mr-2 font-mono text-[13px] text-ink-3">{n}</span>{title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The precise version of the sentence above it, for engineers; easy to skip for everyone else. */
function Detail({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
      <span className="text-ink-2">In detail:</span> {children}
    </p>
  );
}

function Step({ n, title, children, detail }: { n: number; title: string; children: ReactNode; detail: ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-[14px] text-ink"><span className="mr-2 font-mono text-ink-3">{n}</span>{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</p>
      <Detail>{detail}</Detail>
    </div>
  );
}

const CHECKS: { what: string; against: string; result: string }[] = [
  { what: "Where the Sun and Earth are", against: "NASA JPL Horizons' own answer for the same spot and time", result: "within 0.0002° (Sun) and 0.004° (Earth)" },
  { what: "Sunlight over 18.6 years, 302 spots", against: "NASA's south-pole sunlight map (PGDA 69)", result: `typically ${ill.sun.medianAbsPP} percentage points apart (r = ${ill.sun.r})` },
  { what: "Earth visibility, same spots", against: "NASA's Earth-visibility map", result: `typically ${ill.earth.medianAbsPP} percentage points apart (r = ${ill.earth.r})` },
  { what: "Chandrayaan-3 landing, 23 Aug 2023 (past mission, test only)", against: "JPL Horizons and ISRO's mission timeline", result: "Sun 8.6° up at touchdown (JPL: 8.6°); sunset 4 Sep, as the lander slept" },
  { what: "Skyline worked out in your browser", against: "our separate Python version of the engine", result: "typically 0.012° apart (21 spots × 720 directions)" },
  { what: "Skyline drawn in the 3D view", against: "the skyline the numbers use", result: "typically 0.004° apart" },
  { what: "Shadows on the graphics chip", against: "the full calculation", result: "agree 99.2–100% of the time (5 spots, 1,800 moments)" },
  { what: "Best-spot map on the graphics chip", against: "the full calculation at random spots", result: "typically 0.28 percentage points apart" },
  { what: "Countdowns, longest night and blackout", against: "a check every single minute", result: "times within 49 seconds" },
  { what: "Landing calendar ratings", against: "a check every single minute, 310 landing days", result: "0 disagreements" },
];

const SOURCES = [
  ["NASA JPL Horizons System (DE441 ephemeris)", "https://ssd.jpl.nasa.gov/horizons/"],
  ["LOLA south-pole height maps, 40 m and 240 m (NASA PDS)", "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/"],
  ["LOLA average sunlight and Earth-visibility maps (PGDA product 69)", "https://pgda.gsfc.nasa.gov/products/69"],
  ["NASA Artemis III candidate landing regions", "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"],
  ["IAU Gazetteer of Planetary Nomenclature (crater and mountain positions)", "https://planetarynames.wr.usgs.gov/"],
  ["NASA SVS CGI Moon Kit (globe colour and relief)", "https://svs.gsfc.nasa.gov/4720/"],
  ["HLS 8° landing requirement (Aerospace America)", "https://aerospaceamerica.aiaa.org/features/the-choice/"],
];

export default function HowItWorks() {
  const sun = points.points.map((p) => [p[0], p[1]] as [number, number]);
  const earth = points.points.map((p) => [p[2], p[3]] as [number, number]);
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <nav className="flex items-center justify-between border-b border-line pb-4">
        <Link href="/" className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
          <BackIcon /> Back to the 3D view
        </Link>
        <div className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <Mark className="text-ink" /> Lunar Landing Site Navigator
        </div>
      </nav>

      <header className="mt-10 max-w-3xl">
        <p className="eyebrow">How it works</p>
        <h1 className="mt-2 text-[34px] leading-tight font-medium tracking-[-0.015em]">How does the app know?</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          For any spot near the Moon&apos;s south pole, the app answers one question: would a lander there get{" "}
          <span className="text-sun">sunlight for power</span> and be able to{" "}
          <span className="text-earth">talk to Earth</span>, for how long, and what&apos;s the better option if plans change?
        </p>
        <p className="mt-2 text-[12.5px] text-ink-3">Each step is explained in plain words, with the exact details in grey underneath.</p>
      </header>

      <Section n={1} title="Why is it tricky at the south pole?">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              <span className="text-ink">The Sun stays low.</span> At the pole it never climbs high. It circles around
              just a few degrees above the horizon, like a lamp sitting on the floor.
            </p>
            <Detail>at 85°S the Sun is never more than about 6.5° up (5° from the latitude plus at most 1.5° from the Moon&apos;s small axial tilt).</Detail>
          </div>
          <div>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              <span className="text-ink">Mountains get in the way.</span> With the Sun that low, a ridge or crater rim can
              hide it for days. A spot a few hundred metres away can have completely different sunlight.
            </p>
            <Detail>so the horizon must be computed from real terrain, out to 200 km, for each spot.</Detail>
          </div>
          <div>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              <span className="text-ink">Earth bobs up and down.</span> Seen from the pole, Earth rises above and sinks
              below the horizon over about a month. When it&apos;s hidden, a lander can&apos;t radio home directly.
            </p>
            <Detail>the Moon&apos;s libration in latitude moves Earth about ±6.7° over a 27-day cycle.</Detail>
          </div>
        </div>
      </Section>

      <Section n={2} title="What the app uses">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="border border-line-2 bg-white/[0.015] p-4">
            <p className="text-[14px] text-ink">A map of the Moon&apos;s ground</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              NASA&apos;s Lunar Reconnaissance Orbiter has measured the height of the Moon&apos;s surface with a laser since
              2009, giving a 3D map of every mountain and crater.
            </p>
            <Detail>LOLA elevation models: 40 m grid (80–90°S), 240 m (60–90°S), global beyond. Cropped around NASA&apos;s
              9 Artemis III regions and packed losslessly to half size (113 → 61 MB), downloaded once and kept by your browser.</Detail>
          </div>
          <div className="border border-line-2 bg-white/[0.015] p-4">
            <p className="text-[14px] text-ink">Where the Sun and Earth are</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              NASA&apos;s Jet Propulsion Laboratory (JPL) calculates exactly where the Sun and Earth are in the Moon&apos;s
              sky. The app stores their positions for every hour from 2023 to 2028.
            </p>
            <Detail>JPL Horizons, DE441 ephemeris, Moon-fixed (MOON_ME) frame; interpolated between hours.</Detail>
          </div>
        </div>
      </Section>

      <Section n={3} title="What happens when you click a spot">
        <SunlightSketch />
        <div className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <Step n={1} title="Draw the skyline"
                detail="720 directions (every 0.5°), each followed 200 km along the Moon's curved surface, keeping the highest angle; heights 2 m above the ground, where solar panels and antennas sit.">
            The app looks all the way around from your spot and works out how high the mountains reach in every
            direction. It&apos;s the grey mountain outline on the analysis page.
          </Step>
          <Step n={2} title="Find the Sun and Earth"
                detail="positions turned into compass direction and height for that exact spot; the Sun and Earth are treated as discs, not points.">
            Using JPL&apos;s positions, it works out where the Sun and Earth are in the sky above your spot: which
            direction, and how high.
          </Step>
          <Step n={3} title="Compare"
                detail="sunlit when any part of the Sun's disc clears the skyline; Earth in view when its centre does (our rule for a dependable radio link).">
            If the Sun is higher than the mountains in its direction, the lander gets power. If Earth is higher than
            the mountains, the lander can talk home. That&apos;s the picture above.
          </Step>
          <Step n={4} title="Repeat through time"
                detail="checked every 10 minutes; each sunrise, sunset, Earth-rise and Earth-set pinned to 30 seconds. Runs in a background thread so the page never freezes.">
            It does this for every moment across your dates, so it can tell you how long the Sun and Earth stay up,
            when they set and rise again, and the best day to land.
          </Step>
        </div>
      </Section>

      <Section n={4} title="Finding the best spots">
        <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
          <div>
            <p className="font-mono text-[26px] text-ink tabular-nums">{SURVEY_SIGHTLINES.toLocaleString("en-US")}</p>
            <p className="text-[12px] text-ink-3">checks in one search</p>
          </div>
          <div>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              To find the best places to land, the app does the same check for about 260,000 spots at once, at 360 moments
              over your dates, in a few seconds, using your computer&apos;s graphics chip (the part that runs video
              games). Spots too steep to land on are ruled out, and the best ones are checked again in full before you
              see them. The same chip redraws the real shadows on the 3D terrain as time plays.
            </p>
            <Detail>512 × 512 squares × 360 moments × Sun and Earth, ray-marched across the terrain on the GPU; slope limit 8°
              (NASA&apos;s requirement for the HLS lander); shadows re-traced every frame across 200 km of terrain. The whole
              site is static files with no server.</Detail>
          </div>
        </div>
      </Section>

      <Section n={5} title="Can you trust the answers?">
        <p className="max-w-3xl text-[13.5px] leading-relaxed text-ink-2">
          NASA&apos;s scientists have published maps of how often places near the south pole see the Sun and Earth. We ran
          our app over the same 18.6 years, hour by hour, at {points.points.length} spots, and compared. For a typical spot
          our answer is within <span className="text-ink">half a percentage point</span> of NASA&apos;s.
        </p>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">
          To compare with NASA&apos;s 18.6-year map, we ran the same calculation outside the app over those years, using
          NASA&apos;s full terrain map; the app itself stores only 2023–2028 and the nine regions, so it stays small and fast.
          The two give the same answers: their skylines match to about a hundredth of a degree.
        </p>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <div>
            <ValidationScatter title="Sunlight: our answer vs NASA's" points={sun} color="var(--sun)" />
            <Detail>median difference {ill.sun.medianAbsPP} percentage points, correlation {ill.sun.r}, {ill.sun.within5PP}% of spots within 5 points.</Detail>
          </div>
          <div>
            <ValidationScatter title="Earth in view: our answer vs NASA's" points={earth} color="var(--earth)" />
            <Detail>median difference {ill.earth.medianAbsPP} percentage points, correlation {ill.earth.r}, {ill.earth.within5PP}% of spots within 5 points.</Detail>
          </div>
        </div>
        <div className="mt-5 grid max-w-4xl gap-x-8 gap-y-3 text-[13px] leading-relaxed text-ink-2 md:grid-cols-2">
          <p><span className="text-ink">How to read the charts:</span> each dot is one spot. Across is NASA&apos;s answer, up is
            ours. If we agreed perfectly, every dot would sit on the dashed line, and almost all of them do. The few
            below it are in very rugged, deep terrain where the two height maps differ in fine detail. Every spot is
            shown; none were left out.</p>
          <p><span className="text-ink">Tested on real landings:</span> the app is about future Artemis landing sites, so to
            check it against things that really happened we also ran it on two past missions. They aren&apos;t listed in the
            app; we use them only as tests.</p>
        </div>
        <div className="mt-4 grid max-w-4xl gap-4 md:grid-cols-2">
          <div className="border border-line-2 bg-white/[0.015] p-4">
            <p className="text-[14px] text-ink">IM-2 Athena (USA, March 2025)</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              It landed inside the Mons Mouton Plateau region shown in this app. On average NASA&apos;s map says the spot is
              sunlit 46.5% of the time; our engine says 46.3% over the same 18.6 years, and 46.7% over the 2023–2028 dates
              the app covers. Any single month differs: type 84.79°S 29.20°E into the app and its default 30 days from
              14 Nov 2026 show 53%.
            </p>
            <Detail>landing point from LROC imaging, 84.79°S 29.20°E. NASA reference = PGDA 69 120 m map (60 m map: 46.0%).
              18.6-year run: the same engine in Python on the full LOLA terrain; 2023–2028: the in-browser engine on the
              region&apos;s terrain, at ground level like NASA&apos;s maps (47.1% at the app&apos;s usual 2 m).</Detail>
          </div>
          <div className="border border-line-2 bg-white/[0.015] p-4">
            <p className="text-[14px] text-ink">Chandrayaan-3 (India, August 2023)</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              The app says the Sun was 8.6° above the horizon when it touched down, exactly what JPL says, and that the Sun
              set on 4 September, just as the lander was put to sleep for the lunar night.
            </p>
            <Detail>69.37°S 32.32°E (LROC), outside this app&apos;s regions, so tested with the same engine on NASA&apos;s 240 m
              terrain; landing 23 Aug 2023 12:33 UTC (ISRO); computed sunset 4 Sep 07:40 UTC.</Detail>
          </div>
        </div>
        <Detail>reference: {ill.reference}, 120 m maps; {ill.span}; rule: any part of the disc visible.</Detail>

        <h3 className="mt-10 text-[15px] text-ink">Every check we run</h3>
        <p className="mt-1 text-[12px] text-ink-3">All re-run on 14 Nov 2026; every result matched the earlier runs.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 text-ink-3">
                <th className="py-2 pr-4 font-normal">What we check</th>
                <th className="py-2 pr-4 font-normal">Compared with</th>
                <th className="py-2 font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c.what} className="border-b border-line align-top">
                  <td className="py-2 pr-4 text-ink">{c.what}</td>
                  <td className="py-2 pr-4 text-ink-2">{c.against}</td>
                  <td className="py-2 text-ink-2">{c.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={6} title="What it can't do">
        <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-[13.5px] leading-snug text-ink-2">
          <li>It sees mountains and craters, but not individual boulders <span className="text-ink-3">(terrain points are tens of metres apart).</span></li>
          <li>It measures how long there&apos;s sunlight, not how many watts a solar panel would make <span className="text-ink-3">(no power, battery or temperature model yet).</span></li>
          <li>&ldquo;Can talk to Earth&rdquo; means Earth is in plain view <span className="text-ink-3">(a line-of-sight rule, not a full radio model).</span></li>
          <li>The Good/Fair/Poor ratings are our own simple rules, not NASA&apos;s. The 8° slope limit is NASA&apos;s.</li>
          <li>The 3D globe is sharpest near the south pole, where the analysis happens <span className="text-ink-3">(about 89 m per pixel there, 1.3 km elsewhere).</span></li>
          <li>The Sun&apos;s surface in 3D is drawn by the app, since no NASA map of it exists; its position and size are exact.</li>
          <li>Dates can be chosen from 2023 to 2028.</li>
        </ul>
      </Section>

      <Section n={7} title="Where the data comes from">
        <ul className="space-y-1.5 text-[12.5px] text-ink-2">
          {SOURCES.map(([t, u]) => (
            <li key={u}><a href={u} target="_blank" rel="noreferrer" className="border-b border-line-2 hover:border-ink hover:text-ink">{t}</a> <span aria-hidden className="text-ink-3">↗</span></li>
          ))}
        </ul>
      </Section>

      <footer className="mt-16 border-t border-line pt-4 pb-8 text-[11.5px] text-ink-3">
        Team 1.5 Degrees · NASA Space Apps Challenge 2026
      </footer>
    </main>
  );
}
