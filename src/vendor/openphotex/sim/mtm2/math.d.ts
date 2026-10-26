export type Vec3 = Float64Array | number[];
export type Mat3 = Float64Array | number[];
export declare const TWO_PI: number;
/** Fill `m` with M = Ry(psi) · Rx(theta) · Rz(phi). */
export declare function eulerToMatrix(theta: number, phi: number, psi: number, m: Mat3): Mat3;
/** out = M · v (body to world). `out` may not alias `v`. */
export declare function bodyToWorld(m: Mat3, v: Vec3, out: Vec3): Vec3;
/** out = Mᵀ · v (world to body). `out` may not alias `v`. */
export declare function worldToBody(m: Mat3, v: Vec3, out: Vec3): Vec3;
/** Euler angles back from a matrix built by eulerToMatrix (theta within ±π/2). */
export declare function matrixToEuler(m: Mat3, out: Vec3): Vec3;
/** Wrap to [−π, π]. */
export declare function wrapPi(a: number): number;
/** Wrap to [0, 2π). */
export declare function wrapTwoPi(a: number): number;
/** The game's heading of a horizontal direction: atan2(dx, dz), 0 = +z, π/2 = +x. */
export declare function heading(dx: number, dz: number): number;
export declare function dot(a: Vec3, b: Vec3): number;
/** out = a × b. `out` may not alias `a` or `b`. */
export declare function cross(a: Vec3, b: Vec3, out: Vec3): Vec3;
export declare function length(v: Vec3): number;
/** Normalise in place; a zero vector becomes (0, 1, 0), as the game's helper does. */
export declare function normalize(v: Vec3): Vec3;
