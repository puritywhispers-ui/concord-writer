# Generates icons/icon-{180,192,512}.png (dark, gold 13-point star). Run: pip install pillow && python3 make_icons.py
import math, os
from PIL import Image, ImageDraw, ImageFont
os.makedirs('icons', exist_ok=True)
def mk(s):
    im=Image.new('RGB',(s,s),(18,14,22)); d=ImageDraw.Draw(im)
    for r in range(s//2,0,-1):
        c=int(18+20*(1-r/(s/2))); d.ellipse([s/2-r,s/2-r,s/2+r,s/2+r],fill=(c+10,c,c+18))
    cx=cy=s/2; R=s*0.36; gold=(201,162,94)
    pts=[(cx+R*math.cos(2*math.pi*i/13-math.pi/2),cy+R*math.sin(2*math.pi*i/13-math.pi/2)) for i in range(13)]
    for i in range(13): d.line([pts[i],pts[(i+5)%13]],fill=gold,width=max(1,s//110))
    for p in pts: d.ellipse([p[0]-s*.02,p[1]-s*.02,p[0]+s*.02,p[1]+s*.02],fill=gold)
    try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',int(s*.26))
    except Exception: f=ImageFont.load_default()
    d.text((cx,cy),"C",font=f,fill=(240,226,196),anchor='mm')
    im.save(f'icons/icon-{s}.png')
for s in (180,192,512): mk(s)
