import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { CustomerContactPage } from "@/components/business/customer-contact-page";
import { ensureOrganizationPublicSlug } from "@/lib/business/slug";
import { getPublicBusinessBySlug } from "@/lib/business/public-profile";

type PageProps = {
  params: { slug: string };
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const business = await getPublicBusinessBySlug(params.slug);
  if (!business) {
    return { title: "Business not found" };
  }

  return {
    title: `${business.business_name} — Contact & Schedule`,
    description: `Text or call ${business.business_name} to book service with our AI receptionist.`,
  };
}

export default async function BusinessContactPage({ params }: PageProps) {
  let business = await getPublicBusinessBySlug(params.slug);

  if (!business) {
    notFound();
  }

  const slug = await ensureOrganizationPublicSlug(
    business.id,
    business.business_name
  );

  if (slug !== params.slug && !params.slug.match(/^[0-9a-f-]{36}$/i)) {
    redirect(`/b/${slug}`);
  }

  if (slug !== business.public_slug) {
    business = (await getPublicBusinessBySlug(slug)) ?? business;
  }

  return <CustomerContactPage business={business} />;
}
