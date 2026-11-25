/*
 * SelfEvoPI-launcher.c - executavel Windows da CLI.
 *
 * So faz tres coisas: entra na pasta do executavel, acha node.exe no PATH e
 * chama apps/cli.mjs com os argumentos recebidos. Nenhum menu proprio, nenhuma
 * configuracao e nenhuma chave. A conversa continua na pasta da CLI.
 *
 * Compilacao (mingw-w64):
 *   gcc -O2 -s -o download/SelfEvoPI.exe launcher/SelfEvoPI-launcher.c
 */

#include <stdio.h>
#include <string.h>
#include <windows.h>

static void anexa(char *dest, size_t tam, const char *parte) {
    if (strlen(dest) + strlen(parte) + 1 >= tam) return;
    strcat(dest, parte);
}

static void anexa_argumento(char *dest, size_t tam, const char *arg) {
    int precisa_aspas = strchr(arg, ' ') != NULL || strchr(arg, '\t') != NULL;
    anexa(dest, tam, precisa_aspas ? " \"" : " ");
    anexa(dest, tam, arg);
    if (precisa_aspas) anexa(dest, tam, "\"");
}

int main(int argc, char **argv) {
    char raiz[MAX_PATH];
    char node[MAX_PATH];
    char cli[MAX_PATH];
    char cmdline[8192];
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    DWORD saida = 2;
    char *ultimo;
    int i;

    if (GetModuleFileNameA(NULL, raiz, MAX_PATH) == 0) {
        fprintf(stderr, "SelfEvoPI: nao consegui localizar o executavel.\n");
        return 2;
    }
    ultimo = strrchr(raiz, '\\');
    if (ultimo != NULL) *ultimo = '\0';
    SetCurrentDirectoryA(raiz);

    if (SearchPathA(NULL, "node.exe", NULL, MAX_PATH, node, NULL) == 0) {
        fprintf(stderr, "SelfEvoPI: node.exe nao encontrado no PATH.\n");
        fprintf(stderr, "Instale Node 22.19.1 ou mais novo e rode de novo.\n");
        return 2;
    }

    /* Na pasta distribuida o exe esta ao lado de apps/. No repositorio ele
       fica em download/, entao procuramos tambem um nivel acima. */
    snprintf(cli, sizeof(cli), "%s\\apps\\cli.mjs", raiz);
    if (GetFileAttributesA(cli) == INVALID_FILE_ATTRIBUTES) {
        char pai[MAX_PATH];
        snprintf(pai, sizeof(pai), "%s\\..\\apps\\cli.mjs", raiz);
        if (GetFileAttributesA(pai) != INVALID_FILE_ATTRIBUTES) {
            snprintf(cli, sizeof(cli), "%s", pai);
            SetCurrentDirectoryA("..");
        }
    }
    snprintf(cmdline, sizeof(cmdline), "\"%s\" \"%s\"", node, cli);
    for (i = 1; i < argc; i++) anexa_argumento(cmdline, sizeof(cmdline), argv[i]);

    memset(&si, 0, sizeof(si));
    si.cb = sizeof(si);
    memset(&pi, 0, sizeof(pi));
    if (!CreateProcessA(NULL, cmdline, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "SelfEvoPI: falha ao iniciar a CLI (%lu).\n", GetLastError());
        return 2;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &saida);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return (int)saida;
}
