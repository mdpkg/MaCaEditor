import { describe, expect, test } from "vitest";
import { normalizeDiagramSource } from "./aiDiagram";

describe("normalizeDiagramSource", () => {
  test("keeps plain PlantUML", () => expect(normalizeDiagramSource("@startuml\nA->B\n@enduml", "plantuml")).toBe("@startuml\nA->B\n@enduml"));
  test.each(["plantuml", "puml"])("removes a complete %s fence", (lang) => expect(normalizeDiagramSource(`\`\`\`${lang}\n@startuml\nA->B\n@enduml\n\`\`\``, "plantuml")).toBe("@startuml\nA->B\n@enduml"));
  test("removes a complete Mermaid fence", () => expect(normalizeDiagramSource("\`\`\`mermaid\nflowchart TD\nA-->B\n\`\`\`", "mermaid")).toBe("flowchart TD\nA-->B"));
  test("does not repair explanatory text", () => expect(normalizeDiagramSource("Here is the diagram:\n@startuml\n@enduml", "plantuml")).toContain("Here is"));
  test("removes a fence even when the closing fence has no preceding newline", () =>
    expect(normalizeDiagramSource("```plantuml\n@startuml\nA->B\n@enduml```", "plantuml"))
      .toBe("@startuml\nA->B\n@enduml"));
  test("normalizes CRLF fenced Mermaid", () =>
    expect(normalizeDiagramSource("```mermaid\r\nflowchart LR\r\nA-->B\r\n```", "mermaid"))
      .toBe("flowchart LR\nA-->B"));
  test("decodes a JSON string response containing escaped newlines", () =>
    expect(normalizeDiagramSource('"@startuml\\nA -> B\\n@enduml"', "plantuml"))
      .toBe("@startuml\nA -> B\n@enduml"));
  test("extracts source from a small structured response", () =>
    expect(normalizeDiagramSource('{"format":"mermaid","source":"flowchart LR\\nA --> B"}', "mermaid"))
      .toBe("flowchart LR\nA --> B"));
  test("restores escaped newlines in an otherwise plain complete source", () =>
    expect(normalizeDiagramSource("@startuml\\nA -> B\\n@enduml", "plantuml"))
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
    const normalized = normalizeDiagramSource(response, "plantuml");
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
