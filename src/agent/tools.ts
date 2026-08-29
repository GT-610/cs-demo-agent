import type { JsonSchema, ToolSpec } from "./types";

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

const objectSchema = (
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const stringArray: JsonSchema = {
  type: "array",
  items: { type: "string" },
};

const integerArray: JsonSchema = {
  type: "array",
  items: { type: "integer" },
};

export const DEMO_TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_demo_header",
    description:
      "Parse the selected demo header and return map, server, network protocol, and demo version metadata.",
    inputSchema: objectSchema({}),
  },
  {
    name: "get_player_info",
    description:
      "Return the players with Steam ID, initial side, and stable team identity. Team A starts CT; Team B starts T.",
    inputSchema: objectSchema({}),
  },
  {
    name: "list_game_events",
    description:
      "List the game event names that actually occur in the selected demo. Use this before querying uncertain event names.",
    inputSchema: objectSchema({}),
  },
  {
    name: "query_events",
    description:
      "Query one or more game events. Request only the player and global properties needed for the current question.",
    inputSchema: objectSchema({
      event_names: {
        ...stringArray,
        description: 'Event names such as "player_death" or "round_end".',
      },
      player_props: nullable({
        ...stringArray,
        description: "Optional player properties to attach to event participants.",
      }),
      other_props: nullable({
        ...stringArray,
        description: "Optional global game-state properties to attach.",
      }),
      where: nullable(
        objectSchema({
          total_rounds_played: nullable({ type: "integer" }),
          is_warmup_period: nullable({ type: "boolean" }),
          is_freeze_period: nullable({ type: "boolean" }),
          tick: nullable({ type: "integer" }),
          user_name: nullable({ type: "string" }),
          attacker_name: nullable({ type: "string" }),
        }),
      ),
    }),
  },
  {
    name: "query_ticks",
    description:
      "Query player state at specific ticks. Always provide ticks when possible; when omitted, provide a sampling limit.",
    inputSchema: objectSchema({
      wanted_props: {
        ...stringArray,
        description: "Explicit player properties such as X, Y, health, or active_weapon_name.",
      },
      ticks: nullable({
        ...integerArray,
        description: "Specific demo ticks to query.",
      }),
      players: nullable({
        ...stringArray,
        description: "Optional Steam IDs to include.",
      }),
      limit: nullable({
        type: "integer",
        minimum: 1,
        maximum: 10000,
        description: "Maximum rows returned after equidistant sampling.",
      }),
    }),
  },
  {
    name: "query_grenades",
    description:
      "Return grenade trajectories from the selected demo, optionally with extra global properties.",
    inputSchema: objectSchema({
      extra: nullable({
        ...stringArray,
        description: "Optional extra properties to attach to each trajectory sample.",
      }),
    }),
  },
  {
    name: "get_round_summary",
    description:
      "Return a host-aggregated round summary with winner, reason, kills, and available economy evidence. Winner 2/3 and economy t/ct describe the side in that round, not a stable team identity.",
    inputSchema: objectSchema({}),
  },
  {
    name: "get_economy_analysis",
    description:
      "Return per-round side economy values and buy classifications. Map each round's t/ct values back to Team A/B before presenting team trends.",
    inputSchema: objectSchema({}),
  },
];

export const HOST_SYSTEM_ADDENDUM = `

## Host integration rules

- The desktop host owns and validates the active demo path. Tool schemas intentionally omit the local path and inject it after model output, so never invent or request a path argument.
- Tool results use { data, meta }. Inspect meta.truncated and meta.sampled and disclose either condition in the answer.
- A tool error is returned as structured JSON. Explain it directly or retry with a smaller, valid query; never replace missing evidence with a guess.
- Stable team identity is mandatory across side switches: Team A is the roster that starts CT (initial team number 3), and Team B is the roster that starts T (initial team number 2). Use A 队/B 队 in Chinese and Team A/Team B in English. CT/T labels only describe the side occupied during a specific round. Call get_player_info before team-level analysis, map side-scoped round data back to the stable roster, and state the raw side instead of guessing when evidence is insufficient.
`;
