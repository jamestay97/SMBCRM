"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AppointmentCalendar } from "@/components/dashboard/appointment-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_CALENDAR_SETTINGS,
  mergeAvailabilityRows,
  type AvailabilityDraft,
} from "@/lib/calendar/defaults";
import { getMonthRange } from "@/lib/calendar/month-view";
import type {
  AppointmentWithLead,
  TenantCalendarSettings,
} from "@/types/database";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function statusVariant(
  status: AppointmentWithLead["status"]
): "default" | "secondary" | "outline" {
  if (status === "confirmed") return "default";
  if (status === "pending_payment") return "secondary";
  return "outline";
}

function formatStatus(status: AppointmentWithLead["status"]): string {
  if (status === "pending_payment") return "Pending payment";
  if (status === "confirmed") return "Paid";
  return status;
}

function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function toInputTime(value: string): string {
  return value.slice(0, 5);
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatApiError(data: { error?: string; details?: unknown }): string {
  if (data.error) return data.error;
  return "Request failed";
}

export function CalendarPageClient() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [appointments, setAppointments] = useState<AppointmentWithLead[]>([]);
  const [availability, setAvailability] =
    useState<AvailabilityDraft[]>(DEFAULT_AVAILABILITY);
  const [settings, setSettings] = useState<TenantCalendarSettings | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [loading, setLoading] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAppointments = useCallback(
    async (year: number, month: number, tz: string) => {
      setLoadingAppointments(true);
      const range = getMonthRange(year, month, tz);
      const response = await fetch(
        `/api/calendar/appointments?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(formatApiError(data));
      } else {
        setAppointments(data.appointments ?? []);
      }

      setLoadingAppointments(false);
    },
    []
  );

  useEffect(() => {
    async function loadCalendar() {
      setLoadError(null);

      const [availabilityRes, settingsRes] = await Promise.all([
        fetch("/api/calendar/availability"),
        fetch("/api/calendar/settings"),
      ]);

      const availabilityData = await availabilityRes.json();
      const settingsData = await settingsRes.json();

      const errors = [
        !availabilityRes.ok ? availabilityData.error : null,
        !settingsRes.ok ? settingsData.error : null,
      ].filter(Boolean);

      if (errors.length > 0) {
        setLoadError(String(errors[0]));
      } else {
        setAvailability(
          mergeAvailabilityRows(availabilityData.availability ?? DEFAULT_AVAILABILITY)
        );
        setSettings({
          ...(settingsData.settings ?? {}),
          org_id: settingsData.settings?.org_id ?? "",
          slot_duration_minutes:
            settingsData.settings?.slot_duration_minutes ??
            DEFAULT_CALENDAR_SETTINGS.slot_duration_minutes,
          min_notice_hours:
            settingsData.settings?.min_notice_hours ??
            DEFAULT_CALENDAR_SETTINGS.min_notice_hours,
          booking_horizon_days:
            settingsData.settings?.booking_horizon_days ??
            DEFAULT_CALENDAR_SETTINGS.booking_horizon_days,
          limit_appointments_per_slot:
            settingsData.settings?.limit_appointments_per_slot ??
            DEFAULT_CALENDAR_SETTINGS.limit_appointments_per_slot,
          max_appointments_per_slot:
            settingsData.settings?.max_appointments_per_slot ??
            DEFAULT_CALENDAR_SETTINGS.max_appointments_per_slot,
          created_at:
            settingsData.settings?.created_at ?? new Date().toISOString(),
          updated_at:
            settingsData.settings?.updated_at ?? new Date().toISOString(),
        });
        setTimezone(settingsData.timezone ?? "America/New_York");
      }

      setLoading(false);
    }

    loadCalendar().catch(() => {
      setAvailability(DEFAULT_AVAILABILITY);
      setSettings({
        org_id: "",
        ...DEFAULT_CALENDAR_SETTINGS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setLoadError("Failed to load calendar data.");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading) {
      loadAppointments(viewYear, viewMonth, timezone);
    }
  }, [loading, viewYear, viewMonth, timezone, loadAppointments]);

  function handleMonthChange(year: number, month: number) {
    setViewYear(year);
    setViewMonth(month);
  }

  async function saveAvailability() {
    setSavingHours(true);
    const payload = mergeAvailabilityRows(availability).map((row) => ({
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      is_enabled: row.is_enabled,
    }));

    const response = await fetch("/api/calendar/availability", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availability: payload }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(formatApiError(data));
    } else {
      setAvailability(mergeAvailabilityRows(data.availability ?? payload));
      setLoadError(null);
      toast.success("Available hours saved");
    }
    setSavingHours(false);
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;

    setSavingSettings(true);
    const response = await fetch("/api/calendar/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_duration_minutes: settings.slot_duration_minutes,
        min_notice_hours: settings.min_notice_hours,
        booking_horizon_days: settings.booking_horizon_days,
        limit_appointments_per_slot: settings.limit_appointments_per_slot,
        max_appointments_per_slot: settings.max_appointments_per_slot,
        timezone,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(formatApiError(data));
    } else {
      setSettings(data.settings);
      if (data.timezone) {
        setTimezone(data.timezone);
      }
      setLoadError(null);
      toast.success("Booking rules saved");
    }
    setSavingSettings(false);
  }

  function updateAvailabilityRow(
    dayOfWeek: number,
    patch: Partial<AvailabilityDraft>
  ) {
    setAvailability((rows) => {
      const exists = rows.some((row) => row.day_of_week === dayOfWeek);
      if (!exists) {
        return mergeAvailabilityRows([
          ...rows,
          { ...DEFAULT_AVAILABILITY[dayOfWeek], ...patch },
        ]);
      }

      return rows.map((row) =>
        row.day_of_week === dayOfWeek ? { ...row, ...patch } : row
      );
    });
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading calendar...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Calendar</h1>
        <p className="text-muted-foreground">
          View booked appointments and configure when your AI rep can schedule.
          Times shown in <span className="font-medium">{timezone}</span>.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Appointment calendar</CardTitle>
          <CardDescription>
            Confirmed and pending bookings for the selected month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAppointments ? (
            <p className="text-sm text-muted-foreground">Loading appointments...</p>
          ) : (
            <AppointmentCalendar
              appointments={appointments}
              timeZone={timezone}
              year={viewYear}
              month={viewMonth}
              onMonthChange={handleMonthChange}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming list</CardTitle>
          <CardDescription>All appointments this month.</CardDescription>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No appointments this month. When a lead books in webchat or SMS, it
              will appear on the calendar above.
            </p>
          ) : (
            <div className="space-y-3">
              {appointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{appointment.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateTime(appointment.starts_at, timezone)} –{" "}
                      {formatDateTime(appointment.ends_at, timezone)}
                    </p>
                    {appointment.leads && (
                      <p className="text-sm text-muted-foreground">
                        {appointment.leads.name}
                        {appointment.leads.phone
                          ? ` · ${appointment.leads.phone}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(appointment.status)}>
                      {formatStatus(appointment.status)}
                    </Badge>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/leads/${appointment.lead_id}`}>
                        View lead
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available hours</CardTitle>
          <CardDescription>
            Your AI rep only offers times inside these windows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DAY_LABELS.map((label, dayOfWeek) => {
            const row =
              availability.find((r) => r.day_of_week === dayOfWeek) ??
              DEFAULT_AVAILABILITY[dayOfWeek];

            return (
              <div
                key={dayOfWeek}
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[140px_1fr_1fr_auto]"
              >
                <div className="flex items-center gap-2">
                  <input
                    id={`day-${dayOfWeek}`}
                    type="checkbox"
                    checked={row.is_enabled}
                    onChange={(event) =>
                      updateAvailabilityRow(dayOfWeek, {
                        is_enabled: event.target.checked,
                      })
                    }
                  />
                  <Label htmlFor={`day-${dayOfWeek}`}>{label}</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Start</Label>
                  <Input
                    type="time"
                    value={toInputTime(row.start_time)}
                    disabled={!row.is_enabled}
                    onChange={(event) =>
                      updateAvailabilityRow(dayOfWeek, {
                        start_time: `${event.target.value}:00`,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">End</Label>
                  <Input
                    type="time"
                    value={toInputTime(row.end_time)}
                    disabled={!row.is_enabled}
                    onChange={(event) =>
                      updateAvailabilityRow(dayOfWeek, {
                        end_time: `${event.target.value}:00`,
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
          <Button onClick={saveAvailability} disabled={savingHours || !!loadError}>
            {savingHours ? "Saving..." : "Save available hours"}
          </Button>
        </CardContent>
      </Card>

      {settings && (
        <Card>
          <CardHeader>
            <CardTitle>Booking rules</CardTitle>
            <CardDescription>
              Slot length, booking window, and per-slot capacity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSettings} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="timezone">Business timezone</Label>
                <Input
                  id="timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="America/New_York"
                />
                <p className="text-xs text-muted-foreground">
                  All offered slots, bookings, and calendar times use this timezone.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="slot_duration">Slot duration (minutes)</Label>
                <Input
                  id="slot_duration"
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={settings.slot_duration_minutes}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      slot_duration_minutes: parsePositiveInt(
                        event.target.value,
                        settings.slot_duration_minutes
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="min_notice">Minimum notice (hours)</Label>
                <Input
                  id="min_notice"
                  type="number"
                  min={0}
                  max={168}
                  value={settings.min_notice_hours}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      min_notice_hours: parsePositiveInt(
                        event.target.value,
                        settings.min_notice_hours
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="horizon">Booking horizon (days)</Label>
                <Input
                  id="horizon"
                  type="number"
                  min={1}
                  max={90}
                  value={settings.booking_horizon_days}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      booking_horizon_days: parsePositiveInt(
                        event.target.value,
                        settings.booking_horizon_days
                      ),
                    })
                  }
                />
              </div>
              </div>

              <div className="rounded-md border p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <input
                    id="limit_per_slot"
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input"
                    checked={settings.limit_appointments_per_slot}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        limit_appointments_per_slot: event.target.checked,
                      })
                    }
                  />
                  <div className="space-y-1">
                    <Label htmlFor="limit_per_slot" className="cursor-pointer">
                      Limit appointments per time slot
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      When enabled, only a set number of customers can book the
                      same time window. Set to 1 to block double-booking.
                    </p>
                  </div>
                </div>

                {settings.limit_appointments_per_slot && (
                  <div className="max-w-xs space-y-2">
                    <Label htmlFor="max_per_slot">Maximum per slot</Label>
                    <Input
                      id="max_per_slot"
                      type="number"
                      min={1}
                      max={50}
                      value={settings.max_appointments_per_slot}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          max_appointments_per_slot: Math.min(
                            50,
                            Math.max(
                              1,
                              parsePositiveInt(
                                event.target.value,
                                settings.max_appointments_per_slot
                              )
                            )
                          ),
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div>
                <Button type="submit" disabled={savingSettings || !!loadError}>
                  {savingSettings ? "Saving..." : "Save booking rules"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
