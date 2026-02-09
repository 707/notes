#!/usr/bin/env python3
"""Generate placeholder icons for the extension."""
from PIL import Image, ImageDraw, ImageFont

def create_icon(size, filename):
    # Create a gradient blue square
    img = Image.new('RGB', (size, size), color='#4A90E2')
    draw = ImageDraw.Draw(img)

    # Draw a simple "K" for Klue
    # Add a white rounded rectangle
    margin = size // 6
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=size // 8,
        fill='white',
        outline='#4A90E2',
        width=size // 20
    )

    # Add text "K"
    try:
        font_size = size // 2
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        font = ImageFont.load_default()

    text = "K"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - size // 20

    draw.text((x, y), text, fill='#4A90E2', font=font)

    img.save(filename)
    print(f"✓ Created {filename}")

# Create all icon sizes
sizes = [16, 32, 48, 128]
for size in sizes:
    create_icon(size, f'icons/icon{size}.png')

print("\n✅ All icons created!")
