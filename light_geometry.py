"""
Geometria oświetlenia 2 softboxami - prototyp.
Uruchomienie:  python -m streamlit run light_geometry.py

Układ współrzędnych (cm): płaszczyzna obiektu z=0, środek kadru = (0,0,0),
x w prawo, y w górę kadru, z ku aparatowi. Aparat na osi: (0,0,H).
Wzornik/obiekt leży w środku kadru.

Wyniki są WSKAŹNIKAMI GEOMETRYCZNYMI (softbox jako równomierna powierzchnia
Lamberta, powierzchnia obiektu jako płaskie zwierciadło do wyznaczania refleksu),
nie przewidują ΔE. Zweryfikuj zdjęciem pola równomiernego.
"""
import numpy as np

try:
    import streamlit as st
except ImportError:  # pozwala importować funkcje bez streamlit
    st = None

SENSORS = {  # wymiary czynne [mm], orientacja pozioma
    "APS-C (23,5 × 15,6)": (23.5, 15.6),
    "FF (36 × 24)": (36.0, 24.0),
    "44 × 33": (44.0, 33.0),
    "54 × 40": (54.0, 40.0),
}
FOCALS = [28, 35, 50, 80, 100, 120]
NEAR_FACTOR = 1.5  # refleks "blisko": trafienie w softbox powiększony 1,5x


def frame_from_optics(sensor_mm, f_mm, dist_cm, portrait=False):
    """Rozmiar kadru [cm] z cienkiej soczewki: W = sw * (d - f) / f."""
    sw, sh = sensor_mm
    if portrait:
        sw, sh = sh, sw
    f_cm = f_mm / 10.0
    k = (dist_cm - f_cm) / f_cm
    fov_h = np.degrees(2 * np.arctan(sw / (2 * f_mm)))
    fov_v = np.degrees(2 * np.arctan(sh / (2 * f_mm)))
    return sw / 10.0 * k, sh / 10.0 * k, fov_h, fov_v


def lamp_basis(pos, aim):
    """Normalna softboxa (nrm) oraz osie w płaszczyźnie softboxa: u (poziomo), v (pionowo)."""
    pos, aim = np.asarray(pos, float), np.asarray(aim, float)
    nrm = aim - pos
    nrm /= np.linalg.norm(nrm)
    u = np.cross([0, 0, 1.0], nrm)
    if np.linalg.norm(u) < 1e-6:  # lampa dokładnie nad celem
        u = np.array([1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    return nrm, u, v


def lamp_samples(pos, aim, w, h, n=9):
    """Siatka n x n punktów na powierzchni softboxa. w = szerokość (poziomo), h = wysokość (pionowo)."""
    pos = np.asarray(pos, float)
    nrm, u, v = lamp_basis(pos, aim)
    g = (np.arange(n) + 0.5) / n - 0.5
    gu, gv = np.meshgrid(g, g)
    pts = pos + gu.reshape(-1, 1) * w * u + gv.reshape(-1, 1) * h * v
    return pts, nrm, (w * h) / (n * n)


def lamp_corners(pos, aim, w, h):
    """Cztery narożniki softboxa w kolejności cyklicznej."""
    pos = np.asarray(pos, float)
    _, u, v = lamp_basis(pos, aim)
    return np.array([pos + a * w / 2 * u + b * h / 2 * v
                     for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]])


def specular_q(P, cam, lamp):
    """Dla punktów P (N,3): gdzie promień odbity lustrzanie (od aparatu) trafia w płaszczyznę softboxa.
    Zwraca q (N): <1 = trafienie w softbox, 1..NEAR_FACTOR = blisko, 99 = brak; oraz punkty trafienia."""
    aim = lamp.get("aim", (0, 0, 0))
    nrm, u, v = lamp_basis(lamp["pos"], aim)
    pos = np.asarray(lamp["pos"], float)
    view = cam - P
    view /= np.linalg.norm(view, axis=1, keepdims=True)
    r = view.copy()
    r[:, 0] *= -1
    r[:, 1] *= -1
    denom = r @ nrm
    num = (pos - P) @ nrm
    with np.errstate(divide="ignore", invalid="ignore"):
        t = num / denom
    hit = P + np.nan_to_num(t)[:, None] * r
    rel = hit - pos
    q = np.maximum(np.abs(rel @ u) / (lamp["w"] / 2), np.abs(rel @ v) / (lamp["h"] / 2))
    q = np.where(np.isfinite(t) & (t > 0), q, 99.0)
    return q, hit


def analyze(W, Hf, cam_h, lamps, m=50, nx=60):
    """lamps: lista słowników: pos, w, h, power, aim(opcjonalnie)."""
    ny = max(int(round(nx * Hf / W)), 10)
    xs = np.linspace(-W / 2, W / 2, nx)
    ys = np.linspace(-Hf / 2, Hf / 2, ny)
    X, Y = np.meshgrid(xs, ys)
    P = np.stack([X.ravel(), Y.ravel(), np.zeros(X.size)], 1)
    cam = np.array([0, 0, cam_h], float)
    view = cam - P
    view /= np.linalg.norm(view, axis=1, keepdims=True)

    E = np.zeros(len(P))
    Ewth = np.zeros(len(P))
    Wspec = np.zeros(len(P))
    per_lamp_E, theta_c = [], []
    q_min = np.full(len(P), 99.0)

    for L in lamps:
        pts, nrm, dA = lamp_samples(L["pos"], L.get("aim", (0, 0, 0)), L["w"], L["h"])
        d = pts[None, :, :] - P[:, None, :]
        r = np.linalg.norm(d, axis=2)
        l = d / r[..., None]
        cos_i = np.clip(l[..., 2], 0, 1)
        cos_e = np.clip(-(l @ nrm), 0, None)
        wgt = L["power"] * cos_e * cos_i / r**2 * dA
        hv = l + view[:, None, :]
        hv /= np.linalg.norm(hv, axis=2, keepdims=True)
        spec = np.clip(hv[..., 2], 0, 1) ** m
        theta = np.degrees(np.arccos(cos_i))
        e = wgt.sum(1)
        E += e
        Ewth += (wgt * theta).sum(1)
        Wspec += (wgt * spec).sum(1)
        per_lamp_E.append(e)
        dc = np.asarray(L["pos"], float) - P  # kąt liczony do środka softboxa
        theta_c.append(np.degrees(np.arccos(dc[:, 2] / np.linalg.norm(dc, axis=1))))
        q, _ = specular_q(P, cam, L)
        q_min = np.minimum(q_min, q)

    shp = (ny, nx)
    th_eff = (Ewth / E).reshape(shp)
    return dict(
        xs=xs, ys=ys, shape=shp, P=P, cam=cam,
        theta_eff=th_eff,
        dev45=np.abs(th_eff - 45),
        E_pct=((E / E.mean() - 1) * 100).reshape(shp),
        gloss=(Wspec / E).reshape(shp),
        refl_q=q_min.reshape(shp),
        lamp_share=[(e / E).reshape(shp) for e in per_lamp_E],
        theta_c=[t.reshape(shp) for t in theta_c],
    )


def chart_mask(res, cw, ch):
    xs, ys = res["xs"], res["ys"]
    X, Y = np.meshgrid(xs, ys)
    return (np.abs(X) <= cw / 2) & (np.abs(Y) <= ch / 2)


def region_report(res, mask, tol):
    """Statystyki w obszarze (maska). Zwraca None, jeśli maska pusta."""
    if mask.sum() == 0:
        return None
    dev, q, gl = res["dev45"][mask], res["refl_q"][mask], res["gloss"][mask]
    return dict(
        max_dev=float(dev.max()), mean_dev=float(dev.mean()),
        frac_out=float((dev > tol).mean()),
        min_q=float(q.min()), hit=bool(q.min() < 1.0),
        near=bool(q.min() < NEAR_FACTOR), max_gloss=float(gl.max()),
    )


def best_window(res, cw, ch):
    """(opcjonalnie) Okno wzornika o geometrii najbliższej 45/0 i najmniejszym wskaźniku połysku."""
    xs, ys = res["xs"], res["ys"]
    dx, dy = xs[1] - xs[0], ys[1] - ys[0]
    wx, wy = max(int(round(cw / dx)), 1), max(int(round(ch / dy)), 1)
    ny, nx = res["shape"]
    if wx > nx or wy > ny:
        return None
    dev, gl = res["dev45"], res["gloss"]
    best = None
    for j in range(ny - wy + 1):
        for i in range(nx - wx + 1):
            s = dev[j:j + wy, i:i + wx].mean() / max(dev.max(), 1e-9) \
                + gl[j:j + wy, i:i + wx].mean() / max(gl.max(), 1e-9)
            if best is None or s < best[0]:
                best = (s, xs[i], ys[j])
    return dict(score=best[0], x0=best[1], y0=best[2], w=cw, h=ch)


def hotspots(res):
    xs, ys = res["xs"], res["ys"]

    def loc(a, fn):
        j, i = np.unravel_index(fn(a), a.shape)
        return float(xs[i]), float(ys[j]), float(a[j, i])

    return {
        "Największa odchyłka od 45°": loc(res["dev45"], np.argmax),
        "Największy wskaźnik połysku": loc(res["gloss"], np.argmax),
        "Najsłabsze oświetlenie (% od średniej)": loc(res["E_pct"], np.argmin),
    }


def make_figure(res, W, Hf, chart=None, win=None):
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle

    ext = [-W / 2, W / 2, -Hf / 2, Hf / 2]
    panels = [
        ("Efektywny kąt padania θ [°]", res["theta_eff"], "viridis"),
        ("Odchyłka od 45° [°]", res["dev45"], "magma"),
        ("Nierównomierność natężenia [%]", res["E_pct"], "coolwarm"),
        ("Wskaźnik połysku (względny)", res["gloss"], "inferno"),
    ]
    fig, axs = plt.subplots(2, 2, figsize=(11, 8))
    for ax, (t, a, cm) in zip(axs.ravel(), panels):
        im = ax.imshow(a, extent=ext, origin="lower", cmap=cm, aspect="equal")
        ax.set_title(t, fontsize=10)
        ax.set_xlabel("x [cm]")
        ax.set_ylabel("y [cm]")
        fig.colorbar(im, ax=ax, fraction=0.046)
        if chart:
            ax.add_patch(Rectangle((-chart[0] / 2, -chart[1] / 2), chart[0], chart[1],
                                   fill=False, ec="white", lw=1.8, ls="--"))
        if win:
            ax.add_patch(Rectangle((win["x0"], win["y0"]), win["w"], win["h"],
                                   fill=False, ec="cyan", lw=2))
    fig.tight_layout()
    return fig


def make_schematic(W, Hf, cam_h, lamps, res, tol=10.0, chart=None):
    """Schemat: widok z góry (x-y) i z przodu (x-z) z nałożonymi strefami kąta i refleksu."""
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle, Polygon, Patch

    colors = ["tab:blue", "tab:orange"]
    names = ["A", "B"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.6))
    ext = [-W / 2, W / 2, -Hf / 2, Hf / 2]

    # --- widok z góry: strefy w kadrze ---
    ax1.add_patch(Rectangle((-W / 2, -Hf / 2), W, Hf, fc="#eeeeee", ec="k", lw=1.5))
    rgba = np.zeros(res["shape"] + (4,))
    ok = res["dev45"] <= tol
    rgba[ok] = (0.2, 0.7, 0.2, 0.35)
    rgba[~ok] = (1.0, 0.85, 0.0, 0.40)
    q = res["refl_q"]
    rgba[q < NEAR_FACTOR] = (1.0, 0.5, 0.0, 0.65)
    rgba[q < 1.0] = (0.9, 0.0, 0.0, 0.75)
    ax1.imshow(rgba, extent=ext, origin="lower", aspect="equal", zorder=2, interpolation="nearest")
    if chart:
        ax1.add_patch(Rectangle((-chart[0] / 2, -chart[1] / 2), chart[0], chart[1],
                                fill=False, ec="k", lw=2, ls="--", zorder=3))
    ax1.plot(0, 0, "ks", ms=9, mfc="none", zorder=4)
    ax1.annotate("aparat", (0, 0), textcoords="offset points", xytext=(6, 6), fontsize=8, zorder=4)
    xs_all, ys_all = [-W / 2, W / 2], [-Hf / 2, Hf / 2]
    for k, L in enumerate(lamps):
        c = lamp_corners(L["pos"], (0, 0, 0), L["w"], L["h"])
        ax1.add_patch(Polygon(c[:, :2], closed=True, fc=colors[k], alpha=0.35, ec=colors[k], lw=2))
        ax1.plot([L["pos"][0], 0], [L["pos"][1], 0], "--", color=colors[k], lw=1)
        ax1.annotate(names[k], L["pos"][:2], ha="center", va="center", fontweight="bold")
        xs_all += list(c[:, 0]); ys_all += list(c[:, 1])
    ax1.set_title("Widok z góry (x-y): kąt i refleks w kadrze", fontsize=10)
    ax1.set_xlabel("x [cm]"); ax1.set_ylabel("y [cm]")
    ax1.legend(handles=[
        Patch(fc=(0.2, 0.7, 0.2, 0.5), label=f"θ w 45° ± {tol:g}°"),
        Patch(fc=(1.0, 0.85, 0.0, 0.5), label="poza tolerancją kąta"),
        Patch(fc=(1.0, 0.5, 0.0, 0.7), label="refleks blisko softboxa"),
        Patch(fc=(0.9, 0.0, 0.0, 0.8), label="refleks w softboxie"),
    ], loc="upper left", bbox_to_anchor=(0.0, -0.18), ncol=2, fontsize=8, frameon=False)

    # --- widok z przodu (x, z) ---
    ax2.plot([-W / 2, W / 2], [0, 0], "k-", lw=4)
    if chart:
        ax2.plot([-chart[0] / 2, chart[0] / 2], [0, 0], color="gold", lw=6, solid_capstyle="butt")
    ax2.plot(0, cam_h, "k^", ms=11)
    ax2.annotate("aparat", (0, cam_h), textcoords="offset points", xytext=(8, 4), fontsize=8)
    for sx in (-W / 2, W / 2):  # pole widzenia
        ax2.plot([0, sx], [cam_h, 0], ":", color="gray", lw=1)
    xz, zz = [-W / 2, W / 2, 0], [0, 0, cam_h]
    for k, L in enumerate(lamps):
        c = lamp_corners(L["pos"], (0, 0, 0), L["w"], L["h"])
        ax2.add_patch(Polygon(c[:, [0, 2]], closed=True, fc=colors[k], alpha=0.35, ec=colors[k], lw=2))
        ax2.plot([L["pos"][0], 0], [L["pos"][2], 0], "--", color=colors[k], lw=1)
        d = np.array(L["pos"], float)
        ang = np.degrees(np.arctan2(np.hypot(d[0], d[1]), d[2]))
        ax2.annotate(f"{names[k]}: {ang:.0f}°", (L["pos"][0], L["pos"][2]),
                     textcoords="offset points", xytext=(0, 8), ha="center",
                     color=colors[k], fontweight="bold", fontsize=9)
        xz += list(c[:, 0]); zz += list(c[:, 2])

    # najgorszy punkt refleksu: promień od aparatu przez punkt do softboxa
    idx = int(np.argmin(res["refl_q"]))
    if res["refl_q"].ravel()[idx] < NEAR_FACTOR:
        Pw = res["P"][idx:idx + 1]
        best = None
        for L in lamps:
            qq, hit = specular_q(Pw, res["cam"], L)
            if best is None or qq[0] < best[0]:
                best = (qq[0], hit[0])
        col = "red" if best[0] < 1 else "darkorange"
        ax2.plot([res["cam"][0], Pw[0, 0]], [res["cam"][2], 0], "-", color=col, lw=1.5)
        ax2.plot([Pw[0, 0], best[1][0]], [0, best[1][2]], "-", color=col, lw=1.5)
        ax2.plot(Pw[0, 0], 0, "o", color=col, ms=6)
        xz.append(best[1][0]); zz.append(best[1][2])
        ax2.set_title("Widok z przodu (x-z), kąt do środka softboxa;\n"
                      "czerwona linia = najgorszy refleks (rzut na x-z)", fontsize=10)
    else:
        ax2.set_title("Widok z przodu (x-z), kąt do środka softboxa;\nbrak refleksu w kadrze", fontsize=10)
    ax2.set_xlabel("x [cm]"); ax2.set_ylabel("z [cm]")

    for ax, xa, ya in [(ax1, xs_all, ys_all), (ax2, xz, zz)]:
        mx = 0.08 * (max(xa) - min(xa) + 1)
        my = 0.08 * (max(ya) - min(ya) + 1)
        ax.set_xlim(min(xa) - mx, max(xa) + mx)
        ax.set_ylim(min(ya) - my, max(ya) + my)
        ax.set_aspect("equal", adjustable="box")
        ax.grid(alpha=0.3)
    fig.tight_layout()
    return fig


def main():
    st.set_page_config(page_title="Geometria oświetlenia", layout="wide")
    st.title("Geometria oświetlenia: 2 softboxy")
    st.caption("Wskaźniki geometryczne, nie predykcja ΔE. Zweryfikuj zdjęciem pola równomiernego.")

    sb = st.sidebar
    sb.header("Aparat i kadr")
    cam_h = sb.number_input("Odległość obiektyw-obiekt [cm]", 10.0, 500.0, 90.0)
    mode = sb.radio("Kadr", ["z optyki (matryca + ogniskowa)", "ręcznie"])
    if mode.startswith("z optyki"):
        sname = sb.selectbox("Matryca", list(SENSORS.keys()), index=1)
        f_mm = sb.selectbox("Ogniskowa [mm]", FOCALS, index=2)
        portrait = sb.checkbox("Orientacja pionowa", value=False)
        W, Hf, fov_h, fov_v = frame_from_optics(SENSORS[sname], f_mm, cam_h, portrait)
        sb.caption(f"Kadr: {W:.1f} × {Hf:.1f} cm; kąt widzenia {fov_h:.0f}° × {fov_v:.0f}°")
    else:
        W = sb.number_input("Szerokość kadru [cm]", 5.0, 400.0, 60.0)
        Hf = sb.number_input("Wysokość kadru [cm]", 5.0, 400.0, 40.0)
    m = sb.slider("Ostrość refleksu (wykładnik m)", 5, 500, 50,
                  help="Niski = półmatowa powierzchnia, wysoki = błyszcząca")
    tol = sb.slider("Dopuszczalna odchyłka od 45° [°]", 1, 30, 10,
                    help="Twoja tolerancja; zakres wpisz zgodnie z własną procedurą lub wytyczną.")

    lamps = []
    for k, name in enumerate(["Lampa A", "Lampa B"]):
        sb.header(name)
        x = sb.number_input(f"{name}: x [cm]", -300.0, 300.0, -60.0 if k == 0 else 60.0)
        y = sb.number_input(f"{name}: y [cm]", -300.0, 300.0, 0.0)
        z = sb.number_input(f"{name}: wysokość z [cm]", 5.0, 400.0, 60.0)
        w = sb.number_input(f"{name}: softbox poziomo [cm]", 5.0, 250.0, 60.0)
        h = sb.number_input(f"{name}: softbox pionowo [cm]", 5.0, 250.0, 100.0)
        p = sb.number_input(f"{name}: moc względna", 0.05, 10.0, 1.0)
        lamps.append(dict(pos=(x, y, z), w=w, h=h, power=p))

    sb.header("Wzornik / obiekt (w środku kadru)")
    cw = sb.number_input("Szerokość [cm]", 1.0, 400.0, 28.0)
    ch = sb.number_input("Wysokość [cm]", 1.0, 400.0, 21.5)
    suggest = sb.checkbox("Pokaż sugerowane położenie wzornika", value=False)

    res = analyze(W, Hf, cam_h, lamps, m)
    win = best_window(res, cw, ch) if suggest else None

    # ostrzeżenie o nierealnej geometrii
    for name, L in zip(["A", "B"], lamps):
        if lamp_corners(L["pos"], (0, 0, 0), L["w"], L["h"])[:, 2].min() < 0:
            st.warning(f"Softbox {name} schodzi poniżej płaszczyzny obiektu (z<0). "
                       "Podnieś lampę lub zmniejsz softbox.")

    st.subheader("Schemat stanowiska")
    st.pyplot(make_schematic(W, Hf, cam_h, lamps, res, tol, (cw, ch)))

    # werdykt
    st.subheader("Ocena")
    if cw > W or ch > Hf:
        st.warning(f"Wzornik ({cw:g} × {ch:g} cm) jest większy niż kadr ({W:.1f} × {Hf:.1f} cm).")
    rep = region_report(res, chart_mask(res, min(cw, W), min(ch, Hf)), tol)
    full = region_report(res, np.ones(res["shape"], bool), tol)
    if rep:
        if rep["hit"]:
            st.error("Refleks: lustrzane odbicie softboxa trafia w obszar wzornika.")
        elif rep["near"]:
            st.warning("Refleks: odbicie przechodzi blisko krawędzi softboxa "
                       "(rozmyta krawędź softboxa lub półbłysk mogą go uwidocznić).")
        else:
            st.success("Refleks: brak odbicia softboxa w obszarze wzornika.")
        if rep["max_dev"] <= tol:
            st.success(f"Kąt: cały wzornik mieści się w 45° ± {tol}° "
                       f"(maks. odchyłka {rep['max_dev']:.1f}°).")
        else:
            st.warning(f"Kąt: {rep['frac_out'] * 100:.0f}% powierzchni wzornika poza 45° ± {tol}° "
                       f"(maks. odchyłka {rep['max_dev']:.1f}°).")
    if full:
        st.caption(f"Cały kadr: {full['frac_out'] * 100:.0f}% poza tolerancją kąta, "
                   f"maks. odchyłka {full['max_dev']:.1f}°, "
                   f"refleks {'jest' if full['hit'] else 'brak (blisko: ' + ('tak' if full['near'] else 'nie') + ')'}.")

    st.subheader("Kąt liczony do środka softboxa")
    rows = []
    for name, t in zip(["A", "B"], res["theta_c"]):
        j, i = res["shape"][0] // 2, res["shape"][1] // 2
        rows.append({"Lampa": name, "środek kadru [°]": round(float(t[j, i]), 1),
                     "min w kadrze [°]": round(float(t.min()), 1),
                     "max w kadrze [°]": round(float(t.max()), 1)})
    st.table(rows)

    st.pyplot(make_figure(res, W, Hf, (cw, ch), win))

    st.subheader("Gdzie sprawdzać")
    for k, (x, y, v) in hotspots(res).items():
        st.write(f"**{k}:** x={x:.1f} cm, y={y:.1f} cm (wartość {v:.2f})")
    if win:
        st.write(f"**Sugerowane położenie wzornika** (ramka cyjan): lewy dolny róg "
                 f"x={win['x0']:.1f} cm, y={win['y0']:.1f} cm")


if st is not None:
    main()