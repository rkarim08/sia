// Module: scheduler — re-exports from maintenance-scheduler for backward compatibility
//
// The old "nightly scheduler" model has been replaced by the maintenance-scheduler
// with startup-catchup + idle-opportunistic + session-end triggers.

export { runMaintenanceJobs } from "@/decay/maintenance-scheduler";
