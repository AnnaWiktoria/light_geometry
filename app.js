"use strict";
(() => {
	// Clickjacking defence (frame-ancestors cannot be set from a <meta> CSP).
	if (window.top !== window.self) {
		document.body.textContent = "This page cannot be displayed in a frame.";
		return;
	}

	const R = Math.PI / 180,
		$ = s => document.querySelector(s);
	const SENS = new Map([
		["APS-C (23.5×15.6)", [23.5, 15.6]],
		["FF (36×24)", [36, 24]],
		["44×33", [44, 33]],
		["54×40", [54, 40]],
	]);
	const FOCALS = Object.freeze([28, 35, 50, 80, 100, 120]);
	const LIM = Object.freeze({
		d: [20, 500, 1],
		m: [5, 500, 5],
		tol: [1, 30, 1],
		cw: [1, 400, 0.5],
		ch: [1, 400, 0.5],
		x: [-300, 300, 0.5],
		y: [-300, 300, 0.5],
		z: [5, 400, 0.5],
		w: [5, 250, 1],
		h: [5, 250, 1],
		p: [0.05, 10, 0.05],
	});
	const S = {
		d: 90,
		sensor: "FF (36×24)",
		f: 50,
		portrait: false,
		tol: 10,
		m: 50,
		cw: 28,
		ch: 21.5,
		layer: "light",
		lamps: [
			{ x: -60, y: 0, z: 60, w: 60, h: 100, p: 1 },
			{ x: 60, y: 0, z: 60, w: 60, h: 100, p: 1 },
		],
	};
	const COL = ["#5aa9ff", "#ff9f43"],
		V = { top: { h: [] }, side: { h: [] } };
	let drag = null,
		raf = 0,
		A_ = null;

	// ---- input sanitisation: strict parse, clamp, snap to step; nothing else is accepted ----
	function clampv(k, v) {
		const [a, b, s] = LIM[k];
		return +(Math.round(Math.min(b, Math.max(a, v)) / s) * s).toFixed(3);
	}
	function parseNum(raw) {
		if (typeof raw !== "string" || raw.length > 12) return null;
		const t = raw.trim().replace(",", ".");
		if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
		const v = Number(t);
		return Number.isFinite(v) ? v : null;
	}

	// ---- model ----
	const cross = (a, b) => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
	const nrm = a => {
		const l = Math.hypot(...a) || 1;
		return a.map(x => x / l);
	};
	function frame() {
		let [sw, sh] = SENS.get(S.sensor) || SENS.get("FF (36×24)");
		if (S.portrait) [sw, sh] = [sh, sw];
		const fc = S.f / 10,
			k = Math.max((S.d - fc) / fc, 0.2);
		return {
			W: (sw / 10) * k,
			H: (sh / 10) * k,
			fh: (2 * Math.atan(sw / (2 * S.f))) / R,
			fv: (2 * Math.atan(sh / (2 * S.f))) / R,
		};
	}
	function basis(L) {
		const n = nrm([-L.x, -L.y, -L.z]);
		let u = cross([0, 0, 1], n);
		u = Math.hypot(...u) < 1e-6 ? [1, 0, 0] : nrm(u);
		return { n, u, v: cross(n, u) };
	}
	function corners(L) {
		const b = basis(L),
			p = [L.x, L.y, L.z];
		return [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		].map(([a, c]) =>
			[0, 1, 2].map(
				k => p[k] + ((a * L.w) / 2) * b.u[k] + ((c * L.h) / 2) * b.v[k],
			),
		);
	}
	function spec(L, b, x, y, vx, vy, vz) {
		// mirror ray from the camera hits the softbox plane?
		const rx = -vx,
			ry = -vy,
			rz = vz,
			den = rx * b.n[0] + ry * b.n[1] + rz * b.n[2],
			num = (L.x - x) * b.n[0] + (L.y - y) * b.n[1] + L.z * b.n[2],
			t = num / den;
		if (!(isFinite(t) && t > 0)) return { q: 99 };
		const X = x + t * rx,
			Y = y + t * ry,
			Z = t * rz,
			dx = X - L.x,
			dy = Y - L.y,
			dz = Z - L.z;
		return {
			q: Math.max(
				Math.abs(dx * b.u[0] + dy * b.u[1] + dz * b.u[2]) / (L.w / 2),
				Math.abs(dx * b.v[0] + dy * b.v[1] + dz * b.v[2]) / (L.h / 2),
			),
			hit: [X, Y, Z],
		};
	}
	function analyze() {
		const fr = frame(),
			W = fr.W,
			H = fr.H,
			nx = 44,
			ny = Math.min(120, Math.max(10, Math.round((nx * H) / W))),
			N = nx * ny,
			ns = 7;
		const E = new Float32Array(N),
			Ew = new Float32Array(N),
			Ws = new Float32Array(N),
			q = new Float32Array(N).fill(99);
		for (const L of S.lamps) {
			const b = basis(L),
				dA = (L.w * L.h) / (ns * ns),
				pts = [];
			for (let a = 0; a < ns; a++)
				for (let c = 0; c < ns; c++) {
					const ga = (a + 0.5) / ns - 0.5,
						gc = (c + 0.5) / ns - 0.5;
					pts.push(
						[0, 1, 2].map(
							k => [L.x, L.y, L.z][k] + ga * L.w * b.u[k] + gc * L.h * b.v[k],
						),
					);
				}
			for (let j = 0; j < ny; j++)
				for (let i = 0; i < nx; i++) {
					const k = j * nx + i,
						x = -W / 2 + (W * i) / (nx - 1),
						y = -H / 2 + (H * j) / (ny - 1),
						vl = Math.hypot(x, y, S.d),
						vx = -x / vl,
						vy = -y / vl,
						vz = S.d / vl;
					let e = 0,
						ew = 0,
						ws = 0;
					for (const s of pts) {
						const dx = s[0] - x,
							dy = s[1] - y,
							dz = s[2],
							r2 = dx * dx + dy * dy + dz * dz,
							r = Math.sqrt(r2),
							lx = dx / r,
							ly = dy / r,
							lz = dz / r;
						const ci = Math.max(0, lz),
							ce = Math.max(0, -(lx * b.n[0] + ly * b.n[1] + lz * b.n[2])),
							w = ((L.p * ce * ci) / r2) * dA;
						const hx = lx + vx,
							hy = ly + vy,
							hz = lz + vz,
							hl = Math.hypot(hx, hy, hz) || 1;
						e += w;
						ew += (w * Math.acos(Math.min(1, ci))) / R;
						ws += w * Math.pow(Math.max(0, hz / hl), S.m);
					}
					E[k] += e;
					Ew[k] += ew;
					Ws[k] += ws;
					const sp = spec(L, b, x, y, vx, vy, vz);
					if (sp.q < q[k]) q[k] = sp.q;
				}
		}
		let mean = 0,
			mx = 0;
		for (let k = 0; k < N; k++) {
			mean += E[k];
			mx = Math.max(mx, E[k]);
		}
		mean /= N;
		mean = mean || 1;
		mx = mx || 1;
		const th = new Float32Array(N),
			dev = new Float32Array(N),
			ep = new Float32Array(N),
			gl = new Float32Array(N),
			en = new Float32Array(N);
		for (let k = 0; k < N; k++) {
			const e = E[k] || 1e-12;
			th[k] = Ew[k] / e;
			dev[k] = Math.abs(th[k] - 45);
			ep[k] = (E[k] / mean - 1) * 100;
			gl[k] = Ws[k] / e;
			en[k] = E[k] / mx;
		}
		return { fr, nx, ny, N, th, dev, ep, gl, q, en };
	}

	// ---- drawing ----
	const WARM = [
		[18, 12, 6],
		[110, 55, 8],
		[240, 150, 20],
		[255, 215, 90],
		[255, 246, 190],
	];
	const VIR = [
			[68, 1, 84],
			[59, 82, 139],
			[33, 145, 140],
			[94, 201, 98],
			[253, 231, 37],
		],
		DIV = [
			[49, 54, 149],
			[255, 255, 255],
			[165, 0, 38],
		];
	function cm(t, st) {
		t = Math.max(0, Math.min(1, t)) * (st.length - 1);
		const i = Math.min(Math.floor(t), st.length - 2),
			f = t - i;
		return (
			"rgb(" +
			st[i].map((v, k) => Math.round(v + (st[i + 1][k] - v) * f)).join() +
			")"
		);
	}
	function zone(A, k) {
		const q = A.q[k];
		if (S.layer === "light")
			return q < 1
				? "rgba(255,60,50,.85)"
				: q < 1.5
					? "rgba(255,120,40,.6)"
					: cm(Math.pow(A.en[k], 1.6), WARM);
		return q < 1
			? "#d9302c"
			: q < 1.5
				? "#f0a04b"
				: A.dev[k] <= S.tol
					? "#2f8f56"
					: "#b8901f";
	}
	function mkT(id, w, h) {
		const { W, H } = A_.fr,
			HX = Math.max(120, W / 2 + 40),
			HY = Math.max(70, H / 2 + 40);
		if (id === "top") {
			const sc = Math.min(w / (2 * HX), h / (2 * HY));
			return {
				ox: w / 2,
				oy: h / 2,
				sc,
				T: (x, y) => [w / 2 + x * sc, h / 2 - y * sc],
			};
		}
		const HZ = Math.max(S.d * 1.15, 130),
			sc = Math.min(w / (2 * HX), (h - 40) / HZ),
			oy = h - 26;
		return { ox: w / 2, oy, sc, T: (x, z) => [w / 2 + x * sc, oy - z * sc] };
	}
	function poly(g, pts, col) {
		g.beginPath();
		pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
		g.closePath();
		g.fillStyle = col + "59";
		g.fill();
		g.strokeStyle = col;
		g.lineWidth = 2;
		g.stroke();
	}
	function handle(g, px, py, col, t, sq) {
		g.beginPath();
		if (sq) g.rect(px - 6, py - 6, 12, 12);
		else g.arc(px, py, 12, 0, 7);
		g.fillStyle = col;
		g.shadowColor = col;
		g.shadowBlur = 14;
		g.fill();
		g.shadowBlur = 0;
		g.strokeStyle = "#0b0d12";
		g.lineWidth = 2;
		g.stroke();
		if (t) {
			g.fillStyle = "#0b0d12";
			g.font = "bold 13px system-ui";
			g.textAlign = "center";
			g.textBaseline = "middle";
			g.fillText(t, px, py + 1);
		}
	}
	function beam(g, p, o, lp) {
		let dx = o[0] - lp[0],
			dy = o[1] - lp[1];
		const l = Math.hypot(dx, dy) || 1;
		dx /= l;
		dy /= l;
		const pr = q => -dy * q[0] + dx * q[1];
		let a = p[0],
			b = p[0];
		p.forEach(q => {
			if (pr(q) < pr(a)) a = q;
			if (pr(q) > pr(b)) b = q;
		});
		const hx = (b[0] - a[0]) * 0.35,
			hy = (b[1] - a[1]) * 0.35,
			gr = g.createLinearGradient(lp[0], lp[1], o[0], o[1]);
		gr.addColorStop(0, "rgba(255,205,80,.55)");
		gr.addColorStop(1, "rgba(255,205,80,0)");
		g.beginPath();
		g.moveTo(...a);
		g.lineTo(...b);
		g.lineTo(o[0] + hx, o[1] + hy);
		g.lineTo(o[0] - hx, o[1] - hy);
		g.closePath();
		g.fillStyle = gr;
		g.fill();
	}
	function lbl(g, t, x, y, col) {
		g.fillStyle = col;
		g.font = "12px system-ui";
		g.textAlign = "center";
		g.textBaseline = "alphabetic";
		g.fillText(t, x, y);
	}
	function dash(g, a, b, col) {
		g.setLineDash([5, 4]);
		g.strokeStyle = col;
		g.lineWidth = 1;
		g.beginPath();
		g.moveTo(...a);
		g.lineTo(...b);
		g.stroke();
		g.setLineDash([]);
	}

	function drawTop(A) {
		const c = $("#top"),
			g = c.getContext("2d"),
			w = c.width,
			h = c.height,
			{ W, H } = A.fr,
			t = mkT("top", w, h);
		V.top = { ...t, h: [] };
		g.fillStyle = "#0b0d12";
		g.fillRect(0, 0, w, h);
		const cw = (W / (A.nx - 1)) * t.sc,
			chh = (H / (A.ny - 1)) * t.sc,
			o = t.T(0, 0);
		for (let j = 0; j < A.ny; j++)
			for (let i = 0; i < A.nx; i++) {
				const [px, py] = t.T(
					-W / 2 + (W * i) / (A.nx - 1),
					-H / 2 + (H * j) / (A.ny - 1),
				);
				g.fillStyle = zone(A, j * A.nx + i);
				g.fillRect(px - cw / 2, py - chh / 2, cw + 1, chh + 1);
			}
		S.lamps.forEach(L =>
			beam(
				g,
				corners(L).map(p => t.T(p[0], p[1])),
				o,
				t.T(L.x, L.y),
			),
		);
		g.strokeStyle = "rgba(255,210,122,.6)";
		g.lineWidth = 1.5;
		g.strokeRect(...t.T(-W / 2, H / 2), W * t.sc, H * t.sc);
		g.setLineDash([6, 4]);
		g.strokeStyle = "#fff";
		g.strokeRect(...t.T(-S.cw / 2, S.ch / 2), S.cw * t.sc, S.ch * t.sc);
		g.setLineDash([]);
		g.strokeStyle = "#fff";
		g.lineWidth = 1.5;
		g.strokeRect(o[0] - 6, o[1] - 6, 12, 12);
		lbl(g, "camera", o[0] + 26, o[1] - 9, "#ddd");
		S.lamps.forEach((L, k) => {
			poly(
				g,
				corners(L).map(p => t.T(p[0], p[1])),
				COL[k],
			);
			const [px, py] = t.T(L.x, L.y),
				b = basis(L);
			dash(g, [px, py], o, COL[k]);
			[-1, 1].forEach(sg => {
				const [ex, ey] = t.T(
					L.x + (sg * b.u[0] * L.w) / 2,
					L.y + (sg * b.u[1] * L.w) / 2,
				);
				handle(g, ex, ey, COL[k], "", 1);
				V.top.h.push({ k, px: ex, py: ey, ty: "w" });
			});
			handle(g, px, py, COL[k], "AB"[k]);
			V.top.h.push({ k, px, py, ty: "pos" });
			lbl(
				g,
				`x ${L.x}  y ${L.y}  z ${L.z}  ·  ${L.w}×${L.h} cm`,
				px,
				py - 20,
				COL[k],
			);
		});
		S.lamps.forEach((L, k) => {
			const s2 = Math.min(0.6, 80 / Math.max(L.w, L.h)),
				rw = L.w * s2,
				rh = L.h * s2,
				x0 = w - 104,
				y0 = 10 + k * 126,
				cy = y0 + 20 + 45;
			const gr = g.createRadialGradient(
				x0 + 52,
				cy,
				2,
				x0 + 52,
				cy,
				Math.max(rw, rh) * 0.7,
			);
			gr.addColorStop(0, "#fff3b0");
			gr.addColorStop(1, "#e8a317");
			g.fillStyle = gr;
			g.fillRect(x0 + 52 - rw / 2, cy - rh / 2, rw, rh);
			g.strokeStyle = COL[k];
			g.lineWidth = 2;
			g.strokeRect(x0 + 52 - rw / 2, cy - rh / 2, rw, rh);
			lbl(g, `${"AB"[k]}  ${L.w} × ${L.h} cm`, x0 + 52, y0 + 12, COL[k]);
		});
		lbl(g, "Top view (x, y)", 50, 18, "#aaa");
	}
	function drawSide(A) {
		const c = $("#side"),
			g = c.getContext("2d"),
			w = c.width,
			h = c.height,
			{ W } = A.fr,
			t = mkT("side", w, h);
		V.side = { ...t, h: [] };
		g.fillStyle = "#0b0d12";
		g.fillRect(0, 0, w, h);
		const o = t.T(0, 0),
			cam = t.T(0, S.d);
		S.lamps.forEach(L =>
			beam(
				g,
				corners(L).map(p => t.T(p[0], p[2])),
				o,
				t.T(L.x, L.z),
			),
		);
		g.strokeStyle = "rgba(255,255,255,.2)";
		g.setLineDash([2, 4]);
		g.lineWidth = 1;
		[-W / 2, W / 2].forEach(x => {
			g.beginPath();
			g.moveTo(...cam);
			g.lineTo(...t.T(x, 0));
			g.stroke();
		});
		g.setLineDash([]);
		const mid = Math.floor(A.ny / 2) * A.nx;
		g.lineWidth = 7;
		for (let i = 0; i < A.nx - 1; i++) {
			g.strokeStyle = cm(Math.pow(A.en[mid + i], 1.6), WARM);
			g.beginPath();
			g.moveTo(...t.T(-W / 2 + (W * i) / (A.nx - 1), 0));
			g.lineTo(...t.T(-W / 2 + (W * (i + 1)) / (A.nx - 1), 0));
			g.stroke();
		}
		const cs = Math.min(S.cw, W) / 2,
			up = p => [p[0], p[1] - 8];
		g.strokeStyle = "#fff";
		g.lineWidth = 3;
		g.beginPath();
		g.moveTo(...up(t.T(-cs, 0)));
		g.lineTo(...up(t.T(cs, 0)));
		g.stroke();
		g.fillStyle = "#e8e6df";
		g.beginPath();
		g.moveTo(cam[0], cam[1] - 10);
		g.lineTo(cam[0] - 10, cam[1] + 8);
		g.lineTo(cam[0] + 10, cam[1] + 8);
		g.fill();
		V.side.h.push({ k: -1, px: cam[0], py: cam[1] - 2, ty: "cam" });
		lbl(g, `camera ${S.d} cm`, cam[0] + 52, cam[1] + 3, "#ddd");
		let bi = 0;
		for (let k = 1; k < A.N; k++) if (A.q[k] < A.q[bi]) bi = k;
		if (A.q[bi] < 1.5) {
			const x = -W / 2 + (W * (bi % A.nx)) / (A.nx - 1),
				y = -A.fr.H / 2 + (A.fr.H * Math.floor(bi / A.nx)) / (A.ny - 1),
				vl = Math.hypot(x, y, S.d);
			let best = null;
			S.lamps.forEach(L => {
				const s = spec(L, basis(L), x, y, -x / vl, -y / vl, S.d / vl);
				if (!best || s.q < best.q) best = s;
			});
			if (best.hit) {
				g.strokeStyle = best.q < 1 ? "#ff5148" : "#ffa030";
				g.lineWidth = 2;
				g.beginPath();
				g.moveTo(...cam);
				g.lineTo(...t.T(x, 0));
				g.lineTo(...t.T(best.hit[0], best.hit[2]));
				g.stroke();
			}
		}
		S.lamps.forEach((L, k) => {
			poly(
				g,
				corners(L).map(p => t.T(p[0], p[2])),
				COL[k],
			);
			const [px, py] = t.T(L.x, L.z),
				b = basis(L);
			dash(g, [px, py], o, COL[k]);
			[-1, 1].forEach(sg => {
				const [ex, ey] = t.T(
					L.x + (sg * b.v[0] * L.h) / 2,
					L.z + (sg * b.v[2] * L.h) / 2,
				);
				handle(g, ex, ey, COL[k], "", 1);
				V.side.h.push({ k, px: ex, py: ey, ty: "h" });
			});
			handle(g, px, py, COL[k], "AB"[k]);
			V.side.h.push({ k, px, py, ty: "pos" });
			lbl(
				g,
				`${Math.round(Math.atan2(Math.hypot(L.x, L.y), L.z) / R)}° to centre  ·  z ${L.z}  ·  h ${L.h} cm`,
				px,
				py - 20,
				COL[k],
			);
		});
		lbl(g, "Front view (x, z)", 50, 18, "#aaa");
	}
	const MAPS = [
		["Effective incidence angle θ [°]", "th", VIR],
		["Deviation from 45° [°]", "dev", VIR],
		["Illuminance non-uniformity [%]", "ep", DIV],
		["Gloss index (relative)", "gl", VIR],
	];
	function drawMaps(A) {
		const box = $("#maps");
		if (!box.children.length)
			MAPS.forEach(() => {
				const s = document.createElement("section");
				s.append(
					document.createElement("div"),
					Object.assign(document.createElement("canvas"), {
						width: 300,
						height: 200,
					}),
					document.createElement("div"),
				);
				box.append(s);
			});
		const { W, H } = A.fr;
		MAPS.forEach(([ti, key, st], n) => {
			const s = box.children[n],
				c = s.querySelector("canvas"),
				g = c.getContext("2d"),
				a = A[key];
			c.height = Math.round((300 * H) / W);
			let lo = Infinity,
				hi = -Infinity;
			a.forEach(v => {
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			});
			const dv = st === DIV,
				m = Math.max(Math.abs(lo), Math.abs(hi)) || 1,
				cw = c.width / A.nx,
				ch = c.height / A.ny;
			for (let j = 0; j < A.ny; j++)
				for (let i = 0; i < A.nx; i++) {
					const v = a[j * A.nx + i];
					g.fillStyle = cm(
						dv ? 0.5 + v / (2 * m) : (v - lo) / (hi - lo || 1),
						st,
					);
					g.fillRect(i * cw, c.height - (j + 1) * ch, cw + 1, ch + 1);
				}
			const k = c.width / W;
			g.setLineDash([5, 3]);
			g.strokeStyle = "#fff";
			g.lineWidth = 2;
			g.strokeRect(
				c.width / 2 - (S.cw * k) / 2,
				c.height / 2 - (S.ch * k) / 2,
				S.cw * k,
				S.ch * k,
			);
			g.setLineDash([]);
			s.children[0].textContent = ti;
			s.children[2].textContent = `min ${lo.toFixed(2)} … max ${hi.toFixed(2)}`;
		});
	}
	function verdict(A) {
		const { W, H } = A.fr,
			o = [],
			cw = Math.min(S.cw, W),
			chh = Math.min(S.ch, H),
			ids = [];
		for (let j = 0; j < A.ny; j++)
			for (let i = 0; i < A.nx; i++)
				if (
					Math.abs(-W / 2 + (W * i) / (A.nx - 1)) <= cw / 2 &&
					Math.abs(-H / 2 + (H * j) / (A.ny - 1)) <= chh / 2
				)
					ids.push(j * A.nx + i);
		if (!ids.length)
			ids.push(Math.floor(A.ny / 2) * A.nx + Math.floor(A.nx / 2));
		const mq = Math.min(...ids.map(k => A.q[k])),
			md = Math.max(...ids.map(k => A.dev[k])),
			fo = ids.filter(k => A.dev[k] > S.tol).length / ids.length;
		o.push([
			"info",
			`Frame: ${W.toFixed(1)} × ${H.toFixed(1)} cm; field of view ${A.fr.fh.toFixed(0)}° × ${A.fr.fv.toFixed(0)}°.`,
		]);
		if (S.cw > W || S.ch > H)
			o.push(["warn", "The chart is larger than the frame."]);
		o.push(
			mq < 1
				? [
						"err",
						"Reflection: the mirror image of a softbox falls on the chart.",
					]
				: mq < 1.5
					? [
							"warn",
							"Reflection: the mirror ray passes close to a softbox edge (soft edges or semi-gloss may reveal it).",
						]
					: ["ok", "Reflection: no softbox reflection on the chart."],
		);
		o.push(
			md <= S.tol
				? [
						"ok",
						`Angle: the whole chart is within 45° ± ${S.tol}° (max deviation ${md.toFixed(1)}°).`,
					]
				: [
						"warn",
						`Angle: ${(fo * 100).toFixed(0)}% of the chart is outside 45° ± ${S.tol}° (max deviation ${md.toFixed(1)}°).`,
					],
		);
		S.lamps.forEach((L, k) => {
			if (Math.min(...corners(L).map(p => p[2])) < 0)
				o.push([
					"warn",
					`Softbox ${"AB"[k]} extends below the object plane (z<0). Raise the lamp or shrink the softbox.`,
				]);
		});
		$("#verd").replaceChildren(
			...o.map(([c, t]) =>
				Object.assign(document.createElement("div"), {
					className: c,
					textContent: t,
				}),
			),
		);
	}
	function go() {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			A_ = analyze();
			drawTop(A_);
			drawSide(A_);
			drawMaps(A_);
			verdict(A_);
		});
	}

	// ---- UI (built with DOM APIs only; no innerHTML anywhere) ----
	const ups = [];
	const sync = () => ups.forEach(f => f());
	function num(par, lab, o, k, group) {
		const [mn, mx, st] = LIM[k],
			div = document.createElement("div");
		div.className = "f";
		const i = document.createElement("input"),
			r = document.createElement("input"),
			t = document.createElement("span"),
			row = document.createElement("div");
		i.type = "number";
		r.type = "range";
		i.inputMode = "decimal";
		i.autocomplete = "off";
		i.setAttribute("aria-label", lab);
		r.setAttribute("aria-label", lab + " (slider)");
		[i, r].forEach(e => {
			e.min = mn;
			e.max = mx;
			e.step = st;
		});
		t.textContent = lab;
		row.append(t, i);
		div.append(row, r);
		par.append(div);
		const show = () => {
			i.value = String(+o[k].toFixed(2));
			r.value = String(o[k]);
		};
		const apply = raw => {
			const v = parseNum(raw);
			if (v === null) return false;
			o[k] = clampv(k, v);
			go();
			return true;
		};
		i.oninput = () => {
			if (apply(i.value)) r.value = String(o[k]);
		};
		i.onchange = show; // blur/commit: rewrite the field with the sanitised value
		r.oninput = () => {
			apply(r.value);
			i.value = String(o[k]);
		};
		ups.push(show);
		show();
	}
	function sel(par, lab, opts, get, set) {
		const l = document.createElement("label"),
			s = document.createElement("select");
		l.append(lab, s);
		opts.forEach(x => s.add(new Option(String(x), String(x))));
		s.setAttribute("aria-label", lab);
		s.onchange = () => {
			const v = opts.find(x => String(x) === s.value);
			if (v !== undefined) {
				set(v);
				go();
			} else s.value = String(get());
		};
		ups.push(() => {
			s.value = String(get());
		});
		par.append(l);
		s.value = String(get());
	}
	(function build() {
		const c = $("#ctl"),
			h = t => {
				const e = document.createElement("h3");
				e.textContent = t;
				c.append(e);
			};
		h("Camera & frame");
		num(c, "Lens–object distance [cm]", S, "d");
		sel(
			c,
			"Sensor",
			[...SENS.keys()],
			() => S.sensor,
			v => {
				S.sensor = v;
			},
		);
		sel(
			c,
			"Focal length [mm]",
			FOCALS,
			() => S.f,
			v => {
				S.f = v;
			},
		);
		const l = document.createElement("label"),
			p = document.createElement("input");
		p.type = "checkbox";
		p.setAttribute("aria-label", "Portrait orientation");
		l.append("Portrait orientation", p);
		c.append(l);
		p.onchange = () => {
			S.portrait = p.checked === true;
			go();
		};
		ups.push(() => {
			p.checked = S.portrait;
		});
		h("Model");
		num(c, "Gloss exponent m", S, "m");
		num(c, "Tolerance around 45° [°]", S, "tol");
		h("Chart / object (frame centre)");
		num(c, "Width [cm]", S, "cw");
		num(c, "Height [cm]", S, "ch");
		S.lamps.forEach((L, k) => {
			h("Lamp " + "AB"[k]);
			[
				["x", "x [cm]"],
				["y", "y [cm]"],
				["z", "height z [cm]"],
				["w", "softbox width [cm]"],
				["h", "softbox height [cm]"],
				["p", "relative power"],
			].forEach(([q, t]) => num(c, t, L, q));
		});
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = "Mirror: B = reflection of A";
		b.onclick = () => {
			S.lamps[1] = { ...S.lamps[0], x: clampv("x", -S.lamps[0].x) };
			ups.length = 0;
			c.replaceChildren();
			build();
			go();
		};
		c.append(b);
	})();

	// ---- pointer interaction ----
	const pos = (e, c) => {
		const r = c.getBoundingClientRect();
		return [
			((e.clientX - r.left) * c.width) / r.width,
			((e.clientY - r.top) * c.height) / r.height,
		];
	};
	const tip = $("#tip"),
		near = (id, c, p, q) => {
			let best = null,
				bd = (22 * c.width) / c.getBoundingClientRect().width;
			V[id].h.forEach(o => {
				const d = Math.hypot(o.px - p, o.py - q);
				if (d < bd) {
					bd = d;
					best = o;
				}
			});
			return best;
		};
	function hover(e, p, q) {
		const v = V.top,
			A = A_;
		if (!A) return;
		const x = (p - v.ox) / v.sc,
			y = -(q - v.oy) / v.sc,
			{ W, H } = A.fr;
		if (Math.abs(x) > W / 2 || Math.abs(y) > H / 2) {
			tip.hidden = true;
			return;
		}
		const k =
			Math.round(((y + H / 2) / H) * (A.ny - 1)) * A.nx +
			Math.round(((x + W / 2) / W) * (A.nx - 1));
		tip.textContent = [
			`x ${x.toFixed(1)}, y ${y.toFixed(1)} cm`,
			`θ ${A.th[k].toFixed(1)}° (deviation ${A.dev[k].toFixed(1)}°)`,
			`light ${(A.en[k] * 100).toFixed(0)}% of max (${A.ep[k] >= 0 ? "+" : ""}${A.ep[k].toFixed(1)}% vs mean)`,
			`gloss ${A.gl[k].toFixed(3)}`,
			`reflection: ${A.q[k] < 1 ? "yes" : A.q[k] < 1.5 ? "close" : "no"}`,
		].join("\n");
		tip.hidden = false;
		tip.style.left = e.clientX + 14 + "px";
		tip.style.top = e.clientY + 14 + "px";
	}
	["top", "side"].forEach(id => {
		const c = $("#" + id);
		c.onpointerdown = e => {
			const [p, q] = pos(e, c),
				b = near(id, c, p, q);
			if (b) {
				drag = { id, o: b };
				c.setPointerCapture(e.pointerId);
				tip.hidden = true;
			}
		};
		c.onpointermove = e => {
			const [p, q] = pos(e, c),
				v = V[id];
			if (!drag) {
				c.style.cursor = near(id, c, p, q) ? "grab" : "default";
				if (id === "top") hover(e, p, q);
				return;
			}
			if (drag.id !== id) return;
			const o = drag.o,
				L = S.lamps[o.k],
				X = (p - v.ox) / v.sc,
				Y = id === "top" ? -(q - v.oy) / v.sc : (v.oy - q) / v.sc;
			if (!Number.isFinite(X) || !Number.isFinite(Y)) return;
			if (o.ty === "cam") S.d = clampv("d", Y);
			else if (o.ty === "pos" && L) {
				L.x = clampv("x", X);
				if (id === "top") L.y = clampv("y", Y);
				else L.z = clampv("z", Y);
			} else if (L) {
				const b = basis(L),
					a = id === "top" ? [b.u[0], b.u[1]] : [b.v[0], b.v[2]],
					d = [X - L.x, Y - (id === "top" ? L.y : L.z)],
					n = a[0] * a[0] + a[1] * a[1] || 1;
				const len = (2 * Math.abs(d[0] * a[0] + d[1] * a[1])) / n;
				if (o.ty === "w") L.w = clampv("w", len);
				else if (o.ty === "h") L.h = clampv("h", len);
			}
			sync();
			go();
		};
		c.onpointerup = c.onpointercancel = () => {
			drag = null;
		};
		c.onpointerleave = () => {
			tip.hidden = true;
		};
	});
	document.querySelectorAll("[data-l]").forEach(b => {
		b.onclick = () => {
			const v = b.dataset.l;
			if (v !== "light" && v !== "angle") return;
			S.layer = v;
			document
				.querySelectorAll("[data-l]")
				.forEach(x => x.classList.toggle("on", x === b));
			go();
		};
	});
	go();
})();
