// API Request/Response types
export interface CreateServerRequest {
  gameId: string;
  name: string;
  installPath?: string;
  port?: number;
  queryPort?: number;
  launchParams?: string;
}

// Generic API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
