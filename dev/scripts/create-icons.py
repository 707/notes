#!/usr/bin/env python3
"""Generate transparent icons for the extension based on logo-generator.html."""
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, font_size, text, filename):
    # Transparent background (RGBA)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    try:
        # Try to use Helvetica Bold. In TTC, indices vary. 
        # Usually 0=Regular, 1=Bold.
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size, index=1)
    except Exception as e:
        print(f"Warning: Could not load Helvetica Bold ({e}). Trying Regular.")
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except Exception as e2:
             print(f"Warning: Could not load Helvetica ({e2}). Using default.")
             font = ImageFont.load_default()
    
    color = "#5E6AD2"
    
    # Calculate text size and position to center it
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Center adjustment.
        x = (size - text_width) / 2 - bbox[0]
        y = (size - text_height) / 2 - bbox[1]
        
        draw.text((x, y), text, fill=color, font=font)
    except AttributeError:
        # Fallback for older Pillow
        w, h = draw.textsize(text, font=font)
        x = (size - w) / 2
        y = (size - h) / 2
        draw.text((x, y), text, fill=color, font=font)

    img.save(filename)
    print(f"✓ Created {filename}")

# Sizes and corresponding font sizes based on logo-generator.html
# 128px -> 48px, "Gloss"
# 48px -> 34px, "G"
# 32px -> 22px, "G"
# 16px -> 11px, "G"

configs = [
    (128, 48, "Gloss"),
    (48, 34, "G"),
    (32, 22, "G"),
    (16, 11, "G")
]

# Ensure directory exists
os.makedirs('icons', exist_ok=True)

for size, font_s, txt in configs:
    create_icon(size, font_s, txt, f'icons/icon{size}.png')

print("\n✅ All icons created!")
