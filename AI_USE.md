# Use of AI in SUNDIAL

The NASA Space Apps rules allow AI tools. They ask teams to "clearly indicate where and how AI tools were utilized," and to say so in descriptive text and metadata for any AI-generated code. This file is that record. Keep it up to date until we submit.

**Tool:** Claude, an AI assistant made by Anthropic, used through claude.ai.

## Where and how we used it

| Part of the project | How AI was used |
|---|---|
| Choosing and understanding the challenge | Claude explained the MODIS and VIIRS sensors, the orbit drift and the swath idea, compared the challenge options with us, and drafted our team brief. |
| Early "scouting" analysis | Before the event, Claude ran exploratory tests on NASA FIRMS data to check whether the swath method could work. Those numbers are not presented as final results. Every number in the app comes from the pipeline in this repository. |
| Pipeline (`pipeline/`) | Claude wrote the first version (steps `01_download` to `05_build`, plus `recent.py`). Claude also wrote the pooled "dynamic thresholds" in `04_calibrate.py` for small countries and the fixes to the clean and boundaries steps. |
| API (`backend/`) | Claude wrote the first version, including the FastAPI server, the downloads and the tests in `tests/`. |
| Website (`frontend/`) | Claude wrote the globe, the story sections, the country sheets, the in-browser harmonizer check and the regional fire-season explorer, and tuned the globe's speed. Team members reviewed and edited the result. **To confirm:** each author should check this row is accurate. |
| Fixes and tidying (Nov 14) | Claude made the scoreboard handle missing values, updated the README results to the 182-country numbers, added the library credits, and rewrote every code comment in our comment style without changing any code. |
| Writing | Claude helped draft the README and the team brief. |

## What AI did not do

- **No data is AI-generated.** All fire counts come from NASA FIRMS, run through the code in this repository. Anyone can rerun the pipeline to check.
- **The daily fire curve on the public site is a drawn schematic.** It is labeled as such on the site and is not measured data.
- **No AI-generated images or video so far.** If the demo uses any, the rules require a visible watermark saying they are AI-generated, with no NASA branding in them.

## What the team did

- **To confirm:** list what each team member did, for example choosing the challenge, deciding the features, checking results, building the site, the slides and the demo.
