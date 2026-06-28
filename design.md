# Brokerage Assistant Design Palette

Use these colors for all product UI states. The live Tailwind palette is defined in `app/src/app/globals.css`; prefer semantic Tailwind utilities such as `bg-green-50`, `border-amber-200`, `text-red-700`, `bg-blue-500`, `bg-muted`, and `text-primary`.

## Status Colors

| State | Use | Background tint | Border | Text | Dark text | Dot / fill | Strong fill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Green | Confirmed, matched, ready | `#EAF3DE` | `#C0DD97` | `#3B6D11` | `#27500A` | `#639922` |  |
| Amber | Warnings, awaiting sync, conflicts | `#FAEEDA` | `#FAC775` | `#854F0B` | `#633806` | `#EF9F27` | `#BA7517` |
| Red | Errors, missing, danger | `#FCEBEB` | `#F7C1C1` | `#A32D2D` | `#791F1F` | `#E24B4A` |  |
| Blue | New arrivals, info, accent | `#E6F1FB` | `#B5D4F4` | `#185FA5` | `#0C447C` | `#378ADD` |  |
| Gray | Neutral, extracted, inactive | `#F1EFE8` | `#D3D1C7` | `#5F5E5A` | `#444441` | `#888780` |  |

## Base Surfaces And Text

| Token | Hex |
| --- | --- |
| Primary button / black | `#1a1a1a` |
| White on dark | `#ffffff` |

## Tailwind Mapping

- Use `green` for confirmed/matched/ready states. `emerald` is aliased to the same palette for older code.
- Use `amber` for warnings, awaiting sync, and conflicts. `orange` is aliased to the same palette for older code.
- Use `red` for missing, errors, and destructive states.
- Use `blue` for new arrivals, info, links, and accent indicators.
- Use `gray`, `slate`, `muted`, `border`, and `input` for neutral surfaces.
- Avoid adding one-off hex colors in components. Add new palette decisions here first, then wire them through `globals.css`.
