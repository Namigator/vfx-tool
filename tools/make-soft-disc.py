# Writes assets/sprites/soft-disc.png: the editor's untextured billboard as a texture (PreviewViewport.ts:
# mask = 1 - smoothstep(0.6, 1.0, d), d = distance from the centre / half-size). Engine exports use it for procedural
# sprites; the soft-glow dot cell they shipped before was far tighter (dim, small particles; feature grid 2026-10-29).
#   python tools/make-soft-disc.py
import math
from PIL import Image

N = 256


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


im = Image.new('RGBA', (N, N))
px = im.load()
for y in range(N):
    for x in range(N):
        d = math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2
        px[x, y] = (255, 255, 255, round(255 * (1 - smoothstep(0.6, 1.0, d))))
im.save('assets/sprites/soft-disc.png')
print('assets/sprites/soft-disc.png')
