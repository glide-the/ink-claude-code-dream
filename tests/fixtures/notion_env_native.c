// [Input] Test-only native child environment, never an operator credential.
// [Output] Boolean credential-presence facts and keyring-disabled status; no environment values.
// [Pos] Disposable compiled ntn stand-in for actual original-source Bash/hook process tests.
// [Sync] 2026-09-13: verify Notion child isolation without contacting Notion or copying its implementation.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    const char *keyring = getenv("NOTION_KEYRING");
    printf("{\"home\":%s,\"token\":%s,\"workers\":%s,\"keyringDisabled\":%s}\n",
        getenv("NOTION_HOME") ? "true" : "false",
        getenv("NOTION_API_TOKEN") ? "true" : "false",
        getenv("NOTION_WORKERS_CONFIG_FILE") ? "true" : "false",
        keyring && strcmp(keyring, "0") == 0 ? "true" : "false");
    return 0;
}
