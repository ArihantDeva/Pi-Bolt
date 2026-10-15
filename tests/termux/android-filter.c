// android-filter COMMAND...: runs COMMAND under a system call filter like the one Android puts on an app's processes, for the
// calls the runtime could make itself (not through Termux's glibc, which avoids them): each kills the process with SIGSYS, as on
// Android 10, unless the process handles the signal. tests/termux/run.sh.
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <unistd.h>

#define REFUSE(nr) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP)

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: android-filter COMMAND...\n");
        return 2;
    }
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        // Refused to apps until Android 11 (pidfd_open), 12 (the other pidfd calls), 15 (epoll_pwait2), or always (rseq, openat2,
        // fchmodat2, io_uring, futex_waitv). Not clone3 and close_range (refused until Android 15 and 14): Termux's glibc does not
        // make them, and the glibc this runs with does, where no handler sees them (with every signal blocked, or in the child
        // of posix_spawn, whose handlers are reset).
        REFUSE(293), // rseq
        REFUSE(424), // pidfd_send_signal
        REFUSE(425), // io_uring_setup
        REFUSE(426), // io_uring_enter
        REFUSE(427), // io_uring_register
        REFUSE(434), // pidfd_open
        REFUSE(437), // openat2
        REFUSE(438), // pidfd_getfd
        REFUSE(441), // epoll_pwait2
        REFUSE(449), // futex_waitv
        REFUSE(452), // fchmodat2
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { sizeof(filter) / sizeof(filter[0]), filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
        perror("android-filter: seccomp");
        return 2;
    }
    execvp(argv[1], argv + 1);
    perror("android-filter: exec");
    return 127;
}
