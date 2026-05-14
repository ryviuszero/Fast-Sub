package procutil

import (
	"fmt"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"unsafe"
)

const (
	jobObjectExtendedLimitInfoClass = 9
	jobObjectLimitKillOnClose       = 0x00002000

	processTerminate               = 0x0001
	processSetQuota                = 0x0100
	processQueryLimitedInformation = 0x1000
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procOpenProcess              = kernel32.NewProc("OpenProcess")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
)

func configureCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func manageStartedCommand(cmd *exec.Cmd) (func(), error) {
	if cmd == nil || cmd.Process == nil {
		return func() {}, nil
	}

	job, err := createKillOnCloseJob()
	if err != nil {
		return func() {}, err
	}
	processHandle, err := openProcessHandle(cmd.Process.Pid)
	if err != nil {
		_ = syscall.CloseHandle(job)
		return func() {}, err
	}
	defer syscall.CloseHandle(processHandle)

	if err := assignProcessToJob(job, processHandle); err != nil {
		_ = syscall.CloseHandle(job)
		return func() {}, err
	}

	var once sync.Once
	release := func() {
		once.Do(func() {
			_ = syscall.CloseHandle(job)
		})
	}
	return release, nil
}

func terminateProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pid := strconv.Itoa(cmd.Process.Pid)
	kill := exec.Command("taskkill", "/T", "/F", "/PID", pid)
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := kill.Run(); err != nil {
		_ = cmd.Process.Kill()
		return err
	}
	return nil
}

func createKillOnCloseJob() (syscall.Handle, error) {
	handle, _, callErr := procCreateJobObjectW.Call(0, 0)
	if handle == 0 {
		return 0, fmt.Errorf("create job object: %w", callErr)
	}
	job := syscall.Handle(handle)

	info := jobObjectExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnClose
	size := uint32(unsafe.Sizeof(info))
	ret, _, callErr := procSetInformationJobObject.Call(
		uintptr(job),
		uintptr(jobObjectExtendedLimitInfoClass),
		uintptr(unsafe.Pointer(&info)),
		uintptr(size),
	)
	if ret == 0 {
		_ = syscall.CloseHandle(job)
		return 0, fmt.Errorf("set job object limits: %w", callErr)
	}
	return job, nil
}

func openProcessHandle(pid int) (syscall.Handle, error) {
	handle, _, callErr := procOpenProcess.Call(
		uintptr(processTerminate|processSetQuota|processQueryLimitedInformation),
		0,
		uintptr(uint32(pid)),
	)
	if handle == 0 {
		return 0, fmt.Errorf("open process %d: %w", pid, callErr)
	}
	return syscall.Handle(handle), nil
}

func assignProcessToJob(job syscall.Handle, process syscall.Handle) error {
	ret, _, callErr := procAssignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if ret == 0 {
		return fmt.Errorf("assign process to job object: %w", callErr)
	}
	return nil
}
