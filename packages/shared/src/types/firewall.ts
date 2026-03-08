// Firewall rule definition — describes which ports/protocols a game needs
export interface FirewallRuleDefinition {
  /** Offset from the server's base port (e.g. 0 = base port, 4 = base+4) */
  portOffset: number;
  /** Number of consecutive ports starting from base + offset (default: 1) */
  portCount: number;
  /** Network protocol(s) required */
  protocol: "TCP" | "UDP" | "TCP/UDP";
  /** Human-readable description of what these ports are for */
  description: string;
}

// Status of a single firewall rule
export interface FirewallRuleStatus {
  /** Windows Firewall rule name */
  name: string;
  /** Whether the rule exists in Windows Firewall */
  exists: boolean;
  /** Protocol of the rule */
  protocol: string;
  /** Port range string (e.g. "2302-2305" or "27016") */
  ports: string;
  /** Description of what the rule is for */
  description: string;
}

// Overall firewall status for a server
export interface FirewallStatus {
  /** Status of each port-based firewall rule */
  rules: FirewallRuleStatus[];
  /** Whether all rules (including executable rule) are present */
  allPresent: boolean;
  /** Status of the executable/program-based rule */
  executableRule: {
    name: string;
    exists: boolean;
  };
}

// Result of a firewall add/remove operation
export interface FirewallResult {
  success: boolean;
  message: string;
  rulesCreated?: number;
  rulesRemoved?: number;
  errors: string[];
}
