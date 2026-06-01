export default function CampaignsPage() {
  const campaigns = [
    {
      id: 1,
      name: "Mash Coffee TikTok",
      channel: "TikTok",
      status: "Active",
      leads: 42,
    },
    {
      id: 2,
      name: "Bienes y Raíces Facebook",
      channel: "Facebook",
      status: "Draft",
      leads: 0,
    },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">
          📢 Campaign Center
        </h1>

        <button className="border rounded-lg px-4 py-2">
          + Nueva Campaña
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Draft</h3>
          <p className="text-2xl">1</p>
        </div>

        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Scheduled</h3>
          <p className="text-2xl">0</p>
        </div>

        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Active</h3>
          <p className="text-2xl">1</p>
        </div>

        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Optimizing</h3>
          <p className="text-2xl">0</p>
        </div>

        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Completed</h3>
          <p className="text-2xl">0</p>
        </div>

        <div className="border rounded-xl p-4">
          <h3 className="font-semibold">Archived</h3>
          <p className="text-2xl">0</p>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-4">Campaña</th>
              <th className="text-left p-4">Canal</th>
              <th className="text-left p-4">Estado</th>
              <th className="text-left p-4">Leads</th>
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b">
                <td className="p-4">{campaign.name}</td>
                <td className="p-4">{campaign.channel}</td>
                <td className="p-4">{campaign.status}</td>
                <td className="p-4">{campaign.leads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}