"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildMonthGrid,
  dateKeyInTimeZone,
  formatMonthLabel,
  formatTimeInTimeZone,
} from "@/lib/calendar/month-view";
import type { AppointmentWithLead } from "@/types/database";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type AppointmentCalendarProps = {
  appointments: AppointmentWithLead[];
  timeZone: string;
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
};

function statusClass(status: AppointmentWithLead["status"]): string {
  if (status === "confirmed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "pending_payment") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function AppointmentCalendar({
  appointments,
  timeZone,
  year,
  month,
  onMonthChange,
}: AppointmentCalendarProps) {
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const days = buildMonthGrid(year, month);

  const appointmentsByDay = appointments.reduce<
    Record<string, AppointmentWithLead[]>
  >((groups, appointment) => {
    const key = dateKeyInTimeZone(new Date(appointment.starts_at), timeZone);
    groups[key] = groups[key] ?? [];
    groups[key].push(appointment);
    return groups;
  }, {});

  function goToPreviousMonth() {
    const date = new Date(year, month - 1, 1);
    onMonthChange(date.getFullYear(), date.getMonth());
  }

  function goToNextMonth() {
    const date = new Date(year, month + 1, 1);
    onMonthChange(date.getFullYear(), date.getMonth());
  }

  function goToToday() {
    const now = new Date();
    onMonthChange(now.getFullYear(), now.getMonth());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{formatMonthLabel(year, month)}</h2>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goToPreviousMonth}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goToNextMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-slate-50 px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}

        {days.map((day) => {
          const key = dateKeyInTimeZone(day, timeZone);
          const inCurrentMonth = day.getMonth() === month;
          const dayAppointments = appointmentsByDay[key] ?? [];
          const isToday = key === todayKey;

          return (
            <div
              key={key}
              className={cn(
                "min-h-[110px] bg-white p-2",
                !inCurrentMonth && "bg-slate-50/80 text-muted-foreground"
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm",
                    isToday && "bg-primary text-primary-foreground font-semibold"
                  )}
                >
                  {day.getDate()}
                </span>
                {dayAppointments.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {dayAppointments.length}
                  </Badge>
                )}
              </div>

              <div className="space-y-1">
                {dayAppointments.slice(0, 3).map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={`/dashboard/leads/${appointment.lead_id}`}
                    className={cn(
                      "block rounded border px-1.5 py-1 text-[11px] leading-tight hover:opacity-90",
                      statusClass(appointment.status)
                    )}
                  >
                    <div className="font-medium truncate">
                      {formatTimeInTimeZone(appointment.starts_at, timeZone)}{" "}
                      {appointment.leads?.name ?? appointment.title}
                      {appointment.status === "confirmed" ? " · Paid" : ""}
                    </div>
                  </Link>
                ))}
                {dayAppointments.length > 3 && (
                  <p className="text-[10px] text-muted-foreground">
                    +{dayAppointments.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded border border-emerald-200 bg-emerald-50" />
          Paid
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded border border-amber-200 bg-amber-50" />
          Pending payment
        </div>
      </div>
    </div>
  );
}
