# Light Geometry: Dual Softbox Planner

A pre-capture planning tool for reprographic setups (digitization, flat art photography, and color target workflows). Based on camera position, focal length, sensor dimensions, and the spatial positioning of two softboxes, it visualizes key lighting geometry metrics across the frame **before** you take a shot.

- **Effective Angle of Incidence:** Calculates the actual lighting angle at every point across the frame and its deviation from standard $45^\circ/0^\circ$ geometry.
- **Specular Reflection Zones:** Identifies areas where softbox reflections risk entering the lens directly.
- **Relative Illumination Distribution:** Maps light non-uniformity across the capture area.
- **Relative Gloss Index:** Evaluates potential specular highlights based on surface reflectance models.
- **Color Target Geometry Evaluator:** Assesses whether a color target positioned at the center of the frame receives acceptable lighting geometry.

> **Status: Prototype.** This is a geometric model validated qualitatively against real-world studio setups. It is **not** a certification tool and does **not** predict $\Delta E$ values. See [Limitations](#limitations).

<!-- Insert screenshot: docs/screenshot.png -->

## Why This Matters

Standard color targets (e.g., ColorChecker Classic, ColorChecker SG) have reference data measured using strict $45^\circ/0^\circ$ spectrophotometric geometry. In practice, studio constraints, object dimensions, and softbox sizes force deviations from this ideal. Crucially, a large softbox placed close to a subject does not act as a single "45° source"—it emits light across a wide range of angles.

Deviations in lighting geometry affect the specular component (gloss), which most severely alters the measured values of dark and highly saturated color patches. This, in turn, degrades the accuracy of generated ICC/DNG profiles.

This tool helps answer three core questions:

1. What angle of light does each specific point in the frame actually receive?
2. Where will softbox specular reflections appear on the subject?
3. Is the color target positioned within a zone of acceptable geometry?

## Implementations

| File                  | Description                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `light_geometry.html` | **Interactive Web Version.** Standalone single-file application. Runs offline in any browser without installation. Features a dark UI, interactive light positioning via drag-and-drop, softbox resizing, and real-time canvas visualization. |
| `light_geometry.py`   | **Streamlit Version (Reference Python Implementation).** Uses identical underlying physics/math calculations with a parameter-driven UI (sliders and numeric inputs).                                                                         |

_Note: The Python version does not currently include the interactive canvas features present in the HTML version (e.g., direct drag-and-drop handles, direct softbox resizing, dynamic tooltips, or real-time light gradients)._

## Getting Started

### HTML Version

Open `light_geometry.html` directly in any modern web browser, or host it statically via GitHub Pages.

### Streamlit Version

1. Install dependencies:
   ```bash
   pip install streamlit numpy matplotlib
   ```
2. Run the application:
   python -m streamlit run light_geometry.py

   (Using python -m streamlit avoids launcher path issues caused by virtual environment or Python interpreter relocations.)

## Usage Guide (HTML Version)

- **Control Handles A & B:** Drag to position light sources in top-down view ($x, y$) or front view ($x, z$).
- **Corner Handles:** Drag the square endpoints on the softboxes to adjust width (top view) or height (front view).
- **Camera Handle:** Drag the camera icon to adjust lens-to-subject distance.
- **Sidebar Controls:** Every parameter has bidirectional bindings between input fields/sliders and canvas handles.
- **Layer Overlays:**
  - **Light Overlay:** Displays an illumination gradient (yellow intensity map; red/orange highlights indicate specular reflections).
  - **Angle & Reflection Overlay:** Displays angular tolerance zones (green regions indicate $\theta$ within $45^\circ \pm \text{tolerance}$).
- **Cursor Inspection:** Hover over any point on the frame to inspect local values: $\theta$, angular deviation from $45^\circ$, relative intensity, gloss index, and reflection status.
- **Frame Calculation:** Sensor presets (APS-C, Full Frame, Medium Format 44×33 mm, 54×40 mm) paired with focal lengths (28 mm to 120 mm), or custom frame dimensions (manual entry in Streamlit).

## Mathematical & Physical Model

**Coordinate System (cm):**

- Subject plane: $z = 0$
- Frame center: $(0, 0, 0)$
- $+x$: Right, $+y$: Up, $+z$: Towards camera
- Camera origin: $(0, 0, d)$
- Both lights are targeted at the frame center $(0, 0, 0)$.

**Key Equations & Approximations:**

- **Field of View (Thin Lens Model):**
  $$W = \frac{s_w \cdot (d - f)}{f}$$
  _(where $s_w$ is sensor width, $d$ is subject distance, and $f$ is focal length. Note: Lenses with internal focusing, especially macro lenses, may yield a larger field of view in practice)._
- **Softbox Emitter:** Modeled as a planar rectangular surface ($w \times h$) with uniform Lambertian radiance, sampled via a discrete grid ($7 \times 7$ points in HTML, $9 \times 9$ in Python).
- **Point Illumination:** For point $P$ from each softbox sample element:
  $$I = \frac{\text{Power} \cdot \cos\theta_{\text{emitter}} \cdot \cos\theta_{\text{incident}}}{r^2} \cdot dA$$
  Contributions from all discrete elements across both softboxes are summed linearly.
- **Effective Incident Angle ($\theta_{\text{eff}}$):** Weighted average of incident light vectors using illumination intensity as weights. Angular deviation is computed as $|\theta_{\text{eff}} - 45^\circ|$.
- **Gloss Index:** Weighted average of $\cos^m(\alpha)$, where $\alpha$ is the angle between the half-vector and surface normal, and $m$ models specular sharpness (higher $m$ represents glossier surfaces). This serves as a relative comparative index rather than a colorimetric $\Delta E$ metric.
- **Specular Reflection Bounds:** Ray from camera to point $P$ is reflected off $z=0$ (acting as a perfect mirror) and intersected with the softbox plane. Normalized contact coordinates $(a, b)$ relative to softbox center yield:
  $$q = \max\left(\frac{|a|}{w/2}, \frac{|b|}{h/2}\right)$$
  Where $q < 1.0$ indicates direct hit inside softbox bounds, and $q < 1.5$ indicates proximity to softbox edges.
- **Non-Uniformity:** Percentage deviation of point intensity relative to the mean illumination across the frame.

## Limitations

- **Geometric Only:** Does not compute or predict colorimetric differences ($\Delta E$). Gloss indices are relative.
- **Uniform Emitter Assumption:** Assumes constant luminance across the entire softbox area. Diffusion falloff towards edges, baffles, and outer rim frame obstruction are omitted.
- **Specular Model:** Assumes ideal planar mirror reflection for ray tracing. This represents a conservative safety envelope: semi-matte surfaces will show diffuse sheen rather than hard specular reflections, while highly glossy surfaces (varnish, glass) match the model closely.
- **Environmental Factors Excluded:** Ambient bounce light, room reflections, lens vignetting, lens falloff ($\cos^4$), and light source spectral distributions are not modeled.
- **Fixed Targets:** Camera is fixed on-axis facing $(0, 0, 0)$; lights aim directly at origin without independent axial rotation around their own mounts.
- **Sensors & Targets:** Sensor dimensions use nominal dimensions; exact active area varies slightly by camera manufacturer.

## Empirical Validation Workflow

To verify the model against your actual studio environment:

1. **Illumination Uniformity:** Capture an even flat-field target (e.g., neutral gray card). Apply flat-field correction/vignetting compensation and compare actual luminance falloff against the generated intensity map.
2. **Gloss Sensitivity:** Measure target patches with a calibrated $45^\circ/0^\circ$ handheld spectrophotometer. Capture photographs at varying softbox angles. Compare measurement deviations on dark/saturated patches against regions flagged with high Gloss Index values.
3. **Specular Zone Check:** Place a high-gloss plane (glass or polished acrylic) in the capture zone to confirm whether physical reflection bounds match predicted specular highlight areas.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
