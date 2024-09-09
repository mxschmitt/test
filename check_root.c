#include <stdio.h>
#include <unistd.h>
#include <sys/stat.h>

#define ROOT_UID 0

int main() {
    uid_t euid = geteuid();
    struct stat st;

    if (euid == ROOT_UID) {
        if (stat("/", &st) == 0) {
            if (st.st_uid == ROOT_UID) {
                printf("yes\n");
                return 1;
            } else {
                printf("no\n");
            }
        } else {
            perror("stat");
            return -1;
        }
    } else {
        printf("no euid root\n");
    }

    return 0;
}