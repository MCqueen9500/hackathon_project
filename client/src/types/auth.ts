export type Role = "DRIVER" | "POLICE" | "HOSPITAL_ADMIN" | "ADMIN";

export interface TokenPayload {
  sub: string;       // userId
  role: Role;
  hospitalId?: string;
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  hospitalId?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
}
