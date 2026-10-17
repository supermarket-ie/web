terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Remote state is intentionally NOT configured here. Before `terraform init`,
  # set a backend (e.g. S3 + DynamoDB lock) in the Supermarket-Prod account, or
  # run with local state for review only. Do not apply without approval.
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "supermarket-ie"
      Environment = "preview"
      ManagedBy   = "terraform"
      Component   = "aws-migration-preview"
    }
  }
}
