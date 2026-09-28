# Your review pass

Everything planned is built (sound excepted, which you parked). This is the one combined check. It is all
looking and trying — nothing technical. Tell Claude what you see; the words "looks wrong because…" are perfect.

## 1. Look at every effect (about 20 minutes)

1. Double-click `Start-VFX.cmd` and keep its window open.
2. Open **http://127.0.0.1:5174/review.html**.
3. Each strip is one effect from start (left) to end (right). For each: pick *Looks good / OK / Needs work* and write
   what bothers you (too bright, too slow, wrong colour, doesn't look like fire, ends too abruptly…).
4. Press **Copy all notes** at the top and paste the text to Claude.

## 2. Try the editor (about 15 minutes)

Open **http://127.0.0.1:5174/?workspace=v2**.

1. Under the preview: **Add component → Fire: flamethrower → Insert**, then press **Play**. Drag its knobs on the
   right (Jet length, Flame width, Smoke amount) and press Play again.
2. Insert a second one, **Energy: charged bolt**, and set its **Start at** to 60 so it plays after the flame.
3. Change its **Accent colour** with the colour picker.
4. Try **Glow on/off**, **Dark/Light arena** and **Quality**.
5. Click the component box in the graph, then **Save as my component**; insert it again from *My components*.
6. Press **Undo** a few times, then **Redo**.
7. **Keep**, then **New**, then pick it again from **Projects**.
8. Pick **Legacy v1 → Fire / Original → Convert a copy** and read the little report.

For each step: did it do what you expected? Anything confusing, ugly or broken?

## 3. What helps most

- One line per thing: *what* you looked at, *what* you expected, *what* you saw.
- Screenshots are welcome but not needed.
- It is fine to say "I don't like it" without knowing why — Claude will ask a visual follow-up.

After your OK, everything gets merged into the main version.
