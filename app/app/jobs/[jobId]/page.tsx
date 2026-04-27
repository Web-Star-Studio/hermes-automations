import { JobDetail } from "@/components/jobs/job-detail";

type PageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobDetailPage({ params }: PageProps) {
  const { jobId } = await params;

  return <JobDetail jobId={jobId} />;
}
