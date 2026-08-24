import { describe, expect, test } from "vitest";
import { normalizeEditedDiagramSource } from "./aiDiagram";

describe("normalizeEditedDiagramSource", () => {
  test("removes a fence even when the closing fence has no preceding newline", () =>
    expect(normalizeEditedDiagramSource("```plantuml\n@startuml\nA->B\n@enduml```", "plantuml"))
      .toBe("@startuml\nA->B\n@enduml"));
  test("normalizes CRLF fenced Mermaid", () =>
    expect(normalizeEditedDiagramSource("```mermaid\r\nflowchart LR\r\nA-->B\r\n```", "mermaid"))
      .toBe("flowchart LR\nA-->B"));
  test("decodes a JSON string response containing escaped newlines", () =>
    expect(normalizeEditedDiagramSource('"@startuml\\nA -> B\\n@enduml"', "plantuml"))
      .toBe("@startuml\nA -> B\n@enduml"));
  test("extracts source from a small structured response", () =>
    expect(normalizeEditedDiagramSource('{"format":"mermaid","source":"flowchart LR\\nA --> B"}', "mermaid"))
      .toBe("flowchart LR\nA --> B"));
  test("restores escaped newlines in an otherwise plain complete source", () =>
    expect(normalizeEditedDiagramSource("@startuml\\nA -> B\\n@enduml", "plantuml"))
      .toBe("@startuml\nA -> B\n@enduml"));
  test("removes a mislabeled fence and restores collapsed PlantUML statement boundaries", () => {
    const response = `\`\`\`less
@startumlactor Clientparticipant "Security Filter Chain" as SFCparticipant "AuthenticationManager" as AMparticipant "AuthenticationProvider" as APparticipant "UserDetailsService" as UDSparticipant "PasswordEncoder" as PEparticipant "SecurityContext" as SCClient -> SFC: POST /login
SFC -> SFC: Create TokenSFC -> AM: authenticate(token)
AM -> AP: authenticate(token)
AP -> UDS: loadUserByUsername(username)
UDS --> AP: UserDetailsAP -> PE: matches(rawPassword, encodedPassword)
PE --> AP: true/falsealt Authentication Success AP --> AM: authenticated
else Authentication Failure AP --> AM: AuthenticationException AM --> SFC: AuthenticationException
end@enduml
\`\`\``;
    const normalized = normalizeEditedDiagramSource(response, "plantuml");
    expect(normalized).not.toContain("```");
    expect(normalized).toContain("@startuml\nactor Client\nparticipant \"Security Filter Chain\" as SFC");
    expect(normalized).toContain("participant \"SecurityContext\" as SC\nClient -> SFC: POST /login");
    expect(normalized).toContain("SFC -> SFC: Create Token\nSFC -> AM: authenticate(token)");
    expect(normalized).toContain("UDS --> AP: UserDetails\nAP -> PE: matches(rawPassword, encodedPassword)");
    expect(normalized).toContain("PE --> AP: true/false\nalt Authentication Success\nAP --> AM: authenticated");
    expect(normalized).toContain("else Authentication Failure\nAP --> AM: AuthenticationException\nAM --> SFC: AuthenticationException");
    expect(normalized).toContain("end\n@enduml");
  });
});
