"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ForecastChart({ data }: { data: { bucket: number; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="85%">
      <BarChart data={data}>
        <CartesianGrid stroke="#25303b" />
        <XAxis dataKey="bucket" stroke="#8b98a8" />
        <YAxis stroke="#8b98a8" />
        <Tooltip contentStyle={{ background: "#10151c", border: "1px solid #25303b" }} />
        <Bar dataKey="value" fill="#31c48d" />
      </BarChart>
    </ResponsiveContainer>
  );
}
