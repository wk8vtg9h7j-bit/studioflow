export type WeeklyStudioSchedule = {
  weekdayTimes: string[];
  weekendTimes: string[];
};

export const WEEKLY_STUDIO_SCHEDULE: Record<string, WeeklyStudioSchedule> = {
  "downtown-pilates": {
    weekdayTimes: ["06:00", "11:00", "14:00", "16:50", "19:15"],
    weekendTimes: ["07:00", "11:30", "18:00"],
  },
  "hideaway-pilates": {
    weekdayTimes: ["07:30", "09:30", "12:10", "15:10", "18:00"],
    weekendTimes: ["08:30", "10:00", "16:30"],
  },
};
