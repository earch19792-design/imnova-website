"use client";

import { useState } from "react";
import { campaignTypes } from "@/lib/campaign-types";
import { campaignStatuses } from "@/lib/campaign-status";

export default function NewCampaignPage() {
  const [form, setForm] = useState({
    name: "",
    type: "",
    status: "Draft",
    channel: "",
    budget: "",
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">
        🚀 Nueva Campaña
      </h1>

      <div className="space-y-6">

        <div>
          <label className="block mb-2">
            Nombre de la Campaña
          </label>

          <input
            className="w-full border rounded-lg p-3"
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="block mb-2">
            Tipo
          </label>

          <select
            className="w-full border rounded-lg p-3"
            value={form.type}
            onChange={(e) =>
              setForm({
                ...form,
                type: e.target.value,
              })
            }
          >
            <option value="">
              Seleccionar
            </option>

            {campaignTypes.map((type) => (
              <option
                key={type}
                value={type}
              >
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-2">
            Estado
          </label>

          <select
            className="w-full border rounded-lg p-3"
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: e.target.value,
              })
            }
          >
            {campaignStatuses.map((status) => (
              <option
                key={status}
                value={status}
              >
                {status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-2">
            Canal
          </label>

          <input
            className="w-full border rounded-lg p-3"
            placeholder="TikTok"
            value={form.channel}
            onChange={(e) =>
              setForm({
                ...form,
                channel: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="block mb-2">
            Presupuesto
          </label>

          <input
            className="w-full border rounded-lg p-3"
            placeholder="$100"
            value={form.budget}
            onChange={(e) =>
              setForm({
                ...form,
                budget: e.target.value,
              })
            }
          />
        </div>

        <button
          className="px-6 py-3 rounded-lg border"
        >
          Guardar Campaña
        </button>

      </div>
    </div>
  );
}